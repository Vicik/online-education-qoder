import { MediaController } from './media.controller';

// 最小响应替身
function fakeResponse() {
  return {
    setHeader: jest.fn(),
    end: jest.fn(),
    sendFile: jest.fn(),
    headersSent: false,
  };
}

// 合法的媒体 key
const KEY = 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4';
// 未来过期时间
const EXP = String(Math.floor(Date.now() / 1000) + 60);
// 形状正确的签名
const SIG = 'a'.repeat(43);

describe('MediaController', () => {
  it('签名无效返回 403/code=2002', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(false),
    };
    const controller = new MediaController(storage as never);
    await expect(
      controller.media(KEY, EXP, SIG, fakeResponse() as never, jest.fn()),
    ).rejects.toMatchObject({ bizCode: 2002, status: 403 });
  });

  it('文件不存在返回 404/code=1002', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(true),
      mediaExists: jest.fn().mockResolvedValue(false),
    };
    const controller = new MediaController(storage as never);
    await expect(
      controller.media(KEY, EXP, SIG, fakeResponse() as never, jest.fn()),
    ).rejects.toMatchObject({ bizCode: 1002, status: 404 });
  });

  it('配置 X-Accel 时只设置内部重定向并结束响应', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(true),
      mediaExists: jest.fn().mockResolvedValue(true),
      xAccelPrefix: jest.fn().mockReturnValue('/_protected_media/'),
      mediaFilePath: jest.fn(),
      mediaMimeForKey: jest.fn(),
    };
    const response = fakeResponse();
    const controller = new MediaController(storage as never);

    await controller.media(KEY, EXP, SIG, response as never, jest.fn());

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Accel-Redirect',
      `/_protected_media/${KEY}`,
    );
    expect(response.end).toHaveBeenCalled();
    expect(response.sendFile).not.toHaveBeenCalled();
  });

  it('未配置 X-Accel 时由 Nest 发送文件', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(true),
      mediaExists: jest.fn().mockResolvedValue(true),
      xAccelPrefix: jest.fn().mockReturnValue(''),
      mediaFilePath: jest.fn().mockReturnValue('D:/uploads/protected/a.mp4'),
      mediaMimeForKey: jest.fn().mockReturnValue('video/mp4'),
    };
    const response = fakeResponse();
    const controller = new MediaController(storage as never);

    await controller.media(KEY, EXP, SIG, response as never, jest.fn());

    expect(response.sendFile).toHaveBeenCalledWith(
      'D:/uploads/protected/a.mp4',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'video/mp4',
          'Content-Disposition': 'inline',
        }),
      }),
      expect.any(Function),
    );
    expect(response.end).not.toHaveBeenCalled();
  });
});
