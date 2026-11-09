import { Module } from '@nestjs/common';
import { ExamAdminController } from './exam/exam.admin.controller';
import { ExamAdminService } from './exam/exam.admin.service';
import {
  ExamUserController,
  ExamUserRecordController,
} from './exam/exam.user.controller';
import { ExamUserService } from './exam/exam.user.service';
import { QuestionAdminController } from './question/question.admin.controller';
import { QuestionAdminService } from './question/question.admin.service';

// 考试模块：题库管理、考试管理、开始/交卷/成绩（用户端与管理端 controller 分离）
@Module({
  controllers: [
    QuestionAdminController, // /admin/questions
    ExamAdminController, // /admin/exams
    ExamUserController, // /exams
    ExamUserRecordController, // /user/exams
  ],
  providers: [QuestionAdminService, ExamAdminService, ExamUserService],
  exports: [ExamUserService], // 供步骤 12 Worker 调用 autoSubmitExpired
})
export class ExamModule {}
