import { AdminFilesController } from './admin-files.controller';

describe('AdminFilesController', () => {
  it('未选择文件返回 400/code=1001', async () => {
    const controller = new AdminFilesController({} as never);
    await expect(controller.uploadVideo(undefined)).rejects.toMatchObject({
      bizCode: 1001,
      status: 400,
    });
  });

  it('把临时路径与类型交给存储服务', async () => {
    const storage = { saveMedia: jest.fn().mockResolvedValue({ key: 'video/x.mp4' }) };
    const controller = new AdminFilesController(storage as never);

    await controller.uploadVideo({ path: 'D:/uploads/tmp/a.part' } as never);
    expect(storage.saveMedia).toHaveBeenCalledWith({
      tempPath: 'D:/uploads/tmp/a.part',
      kind: 'video',
    });
  });
});
