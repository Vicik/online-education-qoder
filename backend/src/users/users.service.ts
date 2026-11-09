import { Injectable } from '@nestjs/common';
import { Gender } from '@prisma/client';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

// 个人资料响应：与 openapi ProfileData 一致（邮箱只读）
export interface ProfileData {
  id: number; // 用户 id
  email: string; // 邮箱（只读）
  nickname: string; // 昵称
  avatarUrl: string | null; // 头像 URL
  gender: Gender; // 性别
}

// 学习概览响应：与 openapi OverviewData 一致
export interface OverviewData {
  enrolledCount: number; // 已购课程数（已支付订单去重）
  completedCount: number; // 已学完课程数（学习记录覆盖全部章节）
  favoriteCount: number; // 收藏课程数
  couponCount: number; // 未使用券数
  postCount: number; // 发帖数
}

// 用户中心服务：资料读写与学习概览统计
@Injectable()
export class UsersService {
  // 构造函数：注入 Prisma 服务
  constructor(private readonly prisma: PrismaService) {}

  // 读取个人资料
  async getProfile(userId: number): Promise<ProfileData> {
    // 只查对外展示字段
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        avatarUrl: true,
        gender: true,
      },
    });
    // 会话指向的用户已不存在
    if (!profile) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', 401);
    }
    return profile;
  }

  // 修改个人资料（仅昵称/头像/性别）
  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
  ): Promise<ProfileData> {
    // 更新字段：头像未传时保持不变
    const data: {
      nickname: string;
      gender: Gender;
      avatarUrl?: string | null;
    } = { nickname: dto.nickname, gender: dto.gender };
    // 显式传入（含 null）时才更新头像
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;

    // 更新并返回最新资料
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        nickname: true,
        avatarUrl: true,
        gender: true,
      },
    });
  }

  // 学习概览统计
  async getOverview(userId: number): Promise<OverviewData> {
    // 并行执行互不依赖的计数查询
    const [
      paidCourses,
      learningRecords,
      favoriteCount,
      couponCount,
      postCount,
    ] = await Promise.all([
      // 已支付订单涉及的课程（按 courseId 去重）
      this.prisma.order.findMany({
        where: { userId, status: 'paid' },
        distinct: ['courseId'],
        select: { courseId: true },
      }),
      // 学习记录：课程与章节
      this.prisma.learningRecord.findMany({
        where: { userId },
        select: { courseId: true, chapterId: true },
      }),
      // 收藏数
      this.prisma.favorite.count({ where: { userId } }),
      // 未使用券数
      this.prisma.couponClaim.count({ where: { userId, status: 'unused' } }),
      // 发帖数
      this.prisma.post.count({ where: { userId } }),
    ]);

    // 已学完课程数
    const completedCount = await this.countCompletedCourses(learningRecords);

    return {
      enrolledCount: paidCourses.length,
      completedCount,
      favoriteCount,
      couponCount,
      postCount,
    };
  }

  // 计算学习记录已覆盖全部章节的课程数
  private async countCompletedCourses(
    records: { courseId: number; chapterId: number }[],
  ): Promise<number> {
    // 无学习记录直接返回 0，避免多余查询
    if (records.length === 0) return 0;

    // 每门课程已访问的章节集合
    const visitedByCourse = new Map<number, Set<number>>();
    for (const record of records) {
      // 已访问章节集合（首次遇到课程时创建）
      const visited = visitedByCourse.get(record.courseId) ?? new Set<number>();
      visited.add(record.chapterId);
      visitedByCourse.set(record.courseId, visited);
    }

    // 各课程章节总数
    const chapterTotals = await this.prisma.chapter.groupBy({
      by: ['courseId'],
      where: { courseId: { in: [...visitedByCourse.keys()] } },
      _count: { _all: true },
    });
    // 课程 id -> 章节总数
    const totalByCourse = new Map(
      chapterTotals.map((item) => [item.courseId, item._count._all]),
    );

    // 已覆盖全部章节的课程数
    let completed = 0;
    for (const [courseId, visited] of visitedByCourse) {
      if (totalByCourse.get(courseId) === visited.size) completed += 1;
    }
    return completed;
  }
}
