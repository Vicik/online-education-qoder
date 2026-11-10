import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// 全局 MSW 服务端：Node 环境拦截 axios 请求
export const server = setupServer(...handlers);
