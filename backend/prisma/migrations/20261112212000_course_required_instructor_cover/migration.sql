-- 存量数据回填：历史课程允许讲师/封面为空，改非空前先写空串（封面为空时前端显示占位图）
UPDATE "courses" SET "instructor" = '' WHERE "instructor" IS NULL;
UPDATE "courses" SET "coverUrl" = '' WHERE "coverUrl" IS NULL;

-- 讲师与封面改为数据库层必填（创建/编辑接口由 DTO 保证非空）
ALTER TABLE "courses" ALTER COLUMN "instructor" SET NOT NULL;
ALTER TABLE "courses" ALTER COLUMN "coverUrl" SET NOT NULL;
