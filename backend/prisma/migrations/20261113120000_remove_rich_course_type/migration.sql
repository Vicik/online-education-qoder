-- 课程类型收缩为视频/音频：先删除全部图文课程及其关联数据，再移除枚举值 rich。

-- 学习记录与收藏（直接引用课程）
DELETE FROM "learning_records"
WHERE "courseId" IN (SELECT "id" FROM "courses" WHERE "type" = 'rich');

DELETE FROM "favorites"
WHERE "courseId" IN (SELECT "id" FROM "courses" WHERE "type" = 'rich');

-- 拼团成员：按活动、团组或订单关联到图文课程
DELETE FROM "groupon_members"
WHERE "activityId" IN (
    SELECT "id" FROM "groupon_activities" WHERE "courseId" IN (
      SELECT "id" FROM "courses" WHERE "type" = 'rich'
    )
  )
  OR "groupId" IN (
    SELECT "id" FROM "groupon_groups" WHERE "activityId" IN (
      SELECT "id" FROM "groupon_activities" WHERE "courseId" IN (
        SELECT "id" FROM "courses" WHERE "type" = 'rich'
      )
    )
  )
  OR "orderId" IN (
    SELECT "id" FROM "orders" WHERE "courseId" IN (
      SELECT "id" FROM "courses" WHERE "type" = 'rich'
    )
  );

-- 拼团团组
DELETE FROM "groupon_groups"
WHERE "activityId" IN (
  SELECT "id" FROM "groupon_activities" WHERE "courseId" IN (
    SELECT "id" FROM "courses" WHERE "type" = 'rich'
  )
);

-- 支付流水与订单
DELETE FROM "payments"
WHERE "orderId" IN (
  SELECT "id" FROM "orders" WHERE "courseId" IN (
    SELECT "id" FROM "courses" WHERE "type" = 'rich'
  )
);

DELETE FROM "orders"
WHERE "courseId" IN (SELECT "id" FROM "courses" WHERE "type" = 'rich');

-- 活动
DELETE FROM "groupon_activities"
WHERE "courseId" IN (SELECT "id" FROM "courses" WHERE "type" = 'rich');

DELETE FROM "flash_sale_activities"
WHERE "courseId" IN (SELECT "id" FROM "courses" WHERE "type" = 'rich');

-- 课程（章节、券模板关联随课程级联删除）
DELETE FROM "courses" WHERE "type" = 'rich';

-- AlterEnum
BEGIN;
CREATE TYPE "CourseType_new" AS ENUM ('video', 'audio');
ALTER TABLE "courses" ALTER COLUMN "type" TYPE "CourseType_new" USING ("type"::text::"CourseType_new");
ALTER TABLE "chapters" ALTER COLUMN "contentType" TYPE "CourseType_new" USING ("contentType"::text::"CourseType_new");
ALTER TYPE "CourseType" RENAME TO "CourseType_old";
ALTER TYPE "CourseType_new" RENAME TO "CourseType";
DROP TYPE "CourseType_old";
COMMIT;
