import { HttpModule } from "@nestjs/axios";
import { forwardRef, Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CommentEntity } from "src/modules/comments/entities/comment.entity";
import { LinkEntity } from "src/modules/links/entities/links.entity";
import { ProxyModule } from "src/modules/proxy/proxy.module";
import { TokenModule } from "src/modules/token/token.module";
import { GetUuidUserUseCaseModule } from "../get-uuid-user/get-uuid-user.module";
import { GetCommentPublicUseCase } from "./get-comment-public";

@Global()
@Module({
    imports: [HttpModule, forwardRef(() => TokenModule), ProxyModule, GetUuidUserUseCaseModule, TypeOrmModule.forFeature([LinkEntity, CommentEntity])],
    controllers: [],
    providers: [GetCommentPublicUseCase],
    exports: [GetCommentPublicUseCase],
})
export class GetCommentPublicUseCaseModule { }
