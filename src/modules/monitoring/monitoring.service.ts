import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import { Not, Repository } from 'typeorm';
import { CommentEntity } from '../comments/entities/comment.entity';
import { FacebookService } from '../facebook/facebook.service';
import {
  LinkEntity,
  LinkStatus,
  LinkType
} from '../links/entities/links.entity';
import { GroupedLinksByType } from './monitoring.service.i';

dayjs.extend(utc);

type RefreshKey = 'refreshToken' | 'refreshCookie' | 'refreshProxy';
@Injectable()
export class MonitoringService {
  postIdRunning: string[] = []
  linksPublic: LinkEntity[] = []
  linksPrivate: LinkEntity[] = []
  isHandleUrl: boolean = false
  isReHandleUrl: boolean = false
  isHandleUuid: boolean = false
  isCheckProxy: boolean = false
  private jobIntervalHandlers: Record<RefreshKey, NodeJS.Timeout> = {
    refreshToken: null,
    refreshCookie: null,
    refreshProxy: null,
  };

  private currentRefreshMs: Record<RefreshKey, number> = {
    refreshToken: 0,
    refreshCookie: 0,
    refreshProxy: 0,
  };

  constructor(
    @InjectRepository(LinkEntity)
    private linkRepository: Repository<LinkEntity>,
    @InjectRepository(CommentEntity)
    private commentRepository: Repository<CommentEntity>,
    private readonly facebookService: FacebookService,
    private eventEmitter: EventEmitter2
  ) {
  }

  private getPostStarted(): Promise<LinkEntity[]> {
    return this.linkRepository.find({
      where: {
        status: LinkStatus.Started,
        type: Not(LinkType.DIE)
      }
    })
  }

  private groupPostsByType(links: LinkEntity[]): GroupedLinksByType {
    return links.reduce((acc, item) => {
      if (!acc[item.type]) {
        acc[item.type] = [];
      }
      acc[item.type].push(item);
      return acc;
    }, {} as Record<'public' | 'private', typeof links>);
  }


  @Cron(CronExpression.EVERY_5_SECONDS)
  async startMonitoring() {
    const postsStarted = await this.getPostStarted()
    const groupPost = this.groupPostsByType(postsStarted || []);

    return Promise.all([this.handleStartMonitoring((groupPost.public || []), LinkType.PUBLIC), this.handleStartMonitoring((groupPost.private || []), LinkType.PRIVATE)])
  }

  handleStartMonitoring(links: LinkEntity[], type: LinkType) {
    let oldLinksRunning = []
    if (type === LinkType.PUBLIC) {
      oldLinksRunning = this.linksPublic
    } else {
      oldLinksRunning = this.linksPrivate
    }

    const oldIdsSet = new Set(oldLinksRunning.map(item => item.id));
    const linksRunning = links.filter(item => !oldIdsSet.has(item.id));

    if (type === LinkType.PUBLIC) {
      this.linksPublic = links
      return this.handlePostsPublic(linksRunning)
    }
    // else {
    //   this.linksPrivate = links
    //   return this.handlePostsPrivate(linksRunning)
    // }
  }

  async processLinkPublicV1(link: LinkEntity) {
    //process postId 2
    if (link.postIdV1) {
      while (true) {
        if (link.postIdV1 === '122198444798045627') console.time('c')
        const currentLink = await this.linkRepository.findOne({
          where: {
            id: link.id
          }
        })

        const isCheckRuning = this.linksPublic.find(item => item.id === link.id)// check còn nằm trong link
        if (!isCheckRuning) { break };

        try {
          if (!currentLink) break;
          if (link.postIdV1 === '122198444798045627') console.time('d')

          let res = await this.facebookService.getCmtPublic(link.postIdV1) || {} as any
          if (link.postIdV1 === '122198444798045627') console.timeEnd('d')

          if (res && res?.commentId) {
            this.eventEmitter.emit(
              'handle-insert-cmt',
              { res, currentLink },
            );
          }

        } catch (error) {
          console.log(`Crawl comment with postId ${link.postId} Error.`, error?.message)
        } finally {
          await this.delay((currentLink.delayTime ?? 5) * 1000)
          if (link.postIdV1 === '122198444798045627') console.timeEnd('c')
        }
      }
    }

  }

  async handlePostsPublic(linksRunning: LinkEntity[]) {
    const postHandle = linksRunning.map((link) => {
      return this.processLinkPublicV1(link)
    })

    return Promise.all([...postHandle])
  }

  async processLinkPrivate(link: LinkEntity) {
    while (true) {
      const isCheckRuning = this.linksPrivate.find(item => item.id === link.id)// check còn nằm trong link
      if (!isCheckRuning) { break };
      const currentLink = await this.linkRepository.findOne({
        where: {
          id: link.id
        }
      })

      try {
        if (!currentLink) break;
        const dataComment = await this.facebookService.getCommentByToken(link.postId)

        const {
          commentId,
          commentMessage,
          phoneNumber,
          userIdComment,
          userNameComment,
          commentCreatedAt,
        } = dataComment || {}

        if (!commentId || !userIdComment) continue;
        const commentEntities: CommentEntity[] = []
        const linkEntities: LinkEntity[] = []

        const commentEntity: Partial<CommentEntity> = {
          cmtId: commentId,
          linkId: link.id,
          postId: link.postId,
          userId: link.userId,
          uid: userIdComment,
          message: commentMessage,
          phoneNumber,
          name: userNameComment,
          timeCreated: commentCreatedAt as any,
        }
        const comment = await this.getComment(link.id, link.userId, commentId)
        if (!comment) {
          commentEntities.push(commentEntity as CommentEntity)
        }

        const linkEntity: LinkEntity = { ...link, lastCommentTime: !link.lastCommentTime as any || dayjs.utc(commentCreatedAt).isAfter(dayjs.utc(link.lastCommentTime)) ? commentCreatedAt as any : link.lastCommentTime as any }
        linkEntities.push(linkEntity)

        await Promise.all([this.commentRepository.save(commentEntities), this.linkRepository.save(linkEntities)])
      } catch (error) {
        console.log(`Crawl comment with postId ${link.postId} Error.`, error?.message)
      } finally {
        await this.delay((currentLink.delayTime ?? 5) * 1000)
      }
    }

  }

  getRandomNumber() {
    return Math.floor(Math.random() * 1000) + 1;
  }

  async handlePostsPrivate(linksRunning: LinkEntity[]) {
    const postHandle = linksRunning.map((link) => {
      return this.processLinkPrivate(link)
    })

    return Promise.all(postHandle)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  @OnEvent('handle-insert-cmt')
  async handleInsertComment({ res, currentLink }) {
    if (!res?.commentId || !res?.userIdComment) return;
    const commentEntities: CommentEntity[] = []
    const linkEntities: LinkEntity[] = []
    const {
      commentId,
      commentMessage,
      phoneNumber,
      userIdComment,
      userNameComment,
      commentCreatedAt,
    } = res

    const commentEntity: Partial<CommentEntity> = {
      cmtId: commentId,
      linkId: currentLink.id,
      postId: currentLink.postId,
      userId: currentLink.userId,
      uid: userIdComment,
      message: commentMessage,
      phoneNumber,
      name: userNameComment,
      timeCreated: commentCreatedAt as any,
    }
    const comment = await this.getComment(currentLink.id, currentLink.userId, commentId)
    if (!comment) {
      commentEntities.push(commentEntity as CommentEntity)
    }
    const linkEntity: LinkEntity = { ...currentLink, lastCommentTime: !currentLink.lastCommentTime || dayjs.utc(commentCreatedAt).isAfter(dayjs.utc(currentLink.lastCommentTime)) ? commentCreatedAt : currentLink.lastCommentTime }
    linkEntities.push(linkEntity)

    const [comments, _] = await Promise.all([this.commentRepository.save(commentEntities), this.linkRepository.save(linkEntities)])
    this.eventEmitter.emit(
      'hide.cmt',
      comments,
    );
  }

  private getComment(linkId: number, userId: number, cmtId: string) {
    return this.commentRepository.findOne({
      where: {
        linkId,
        userId,
        cmtId
      },
      select: {
        id: true
      }
    })
  }
}
