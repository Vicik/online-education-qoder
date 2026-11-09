import type { ExamUserService } from '../exam/exam/exam.user.service';
import { ExamAutoSubmitJob } from './exam-auto-submit.job';

describe('ExamAutoSubmitJob', () => {
  it('代理 autoSubmitExpired(now) 并返回处理数', async () => {
    const exams = {
      autoSubmitExpired: jest.fn().mockResolvedValue(1),
    };
    const job = new ExamAutoSubmitJob(exams as unknown as ExamUserService);
    const now = new Date();

    await expect(job.run(now)).resolves.toBe(1);
    expect(exams.autoSubmitExpired).toHaveBeenCalledWith(now);
  });
});
