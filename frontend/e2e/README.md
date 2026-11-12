# E2E 运行说明

## 前置

1. PostgreSQL 已执行 `backend/npm run prisma:migrate` 与 `npm run prisma:seed`。
2. Redis 已启动。
3. 后端 `backend/npm run start:dev`（或构建后 `node dist/src/main.js`）。
4. 前端 `cd frontend && npm run dev`。

## 运行

```bash
cd frontend
npm run test:e2e
```

CI 见 `.github/workflows/frontend-e2e.yml`；本地 Docker 不可靠时不要求本机跑通，以 CI 结果为准。
