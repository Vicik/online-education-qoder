import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { SubmitAttemptDto } from '../dto/submit-attempt.dto';
import { ExamUserService } from './exam.user.service';

// 考试用户端控制器：浏览已发布考试、开始/交卷/查看成绩（/api/v1/exams）
@Controller('exams')
export class ExamUserController {
  // 构造函数：注入考试用户端服务
  constructor(private readonly exams: ExamUserService) {}

  // 已发布考试列表
  @Get()
  list(@Query() page: PageQuery) {
    return this.exams.listPublished(page);
  }

  // 考试详情（不含答案/解析）
  @Get(':id')
  detail(@Param('id', ParseIntPipe) examId: number) {
    return this.exams.getDetail(examId);
  }

  // 开始考试（每人每场唯一；返回服务端 deadline）
  @Post(':id/attempts')
  start(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) examId: number,
  ) {
    return this.exams.startAttempt(user!.userId, examId);
  }

  // 交卷（幂等；服务端判分；超时 422）
  @Post(':id/attempts/:aid/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) examId: number,
    @Param('aid', ParseIntPipe) attemptId: number,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.exams.submitAttempt(user!.userId, examId, attemptId, dto);
  }

  // 成绩与解析（未交卷 422）
  @Get(':id/attempts/:aid/result')
  result(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) examId: number,
    @Param('aid', ParseIntPipe) attemptId: number,
  ) {
    return this.exams.getResult(user!.userId, examId, attemptId);
  }
}

// 我的考试记录控制器：/api/v1/user/exams
@Controller('user')
export class ExamUserRecordController {
  // 构造函数：注入考试用户端服务
  constructor(private readonly exams: ExamUserService) {}

  // 我的考试（成绩记录）
  @Get('exams')
  mine(@CurrentUser() user: CurrentUserInfo | null, @Query() page: PageQuery) {
    return this.exams.listMine(user!.userId, page);
  }
}
