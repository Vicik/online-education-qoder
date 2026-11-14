import dayjs from 'dayjs';
import {
  disabledPastDate,
  disabledPastTime,
  fromPickerValue,
  toPickerValue,
} from '@/features/admin/promotions/time';
import {
  toGrouponCreatePayload,
  toGrouponUpdatePayload,
} from '@/features/admin/groupons/payload';
import {
  toFlashSaleCreatePayload,
  toFlashSaleUpdatePayload,
} from '@/features/admin/flash-sales/payload';
import {
  toCouponCreatePayload,
  toCouponFormValues,
  toCouponUpdatePayload,
} from '@/features/admin/coupons/payload';

// 上海时间 2026-11-20 10:00 对应的 UTC ISO
const START_ISO = '2026-11-20T02:00:00.000Z';
// 上海时间 2026-11-27 10:00 对应的 UTC ISO
const END_ISO = '2026-11-27T02:00:00.000Z';

describe('promotion payload', () => {
  it('DatePicker 值与 ISO 往返一致，并按上海时区解释钟面时间', () => {
    const picker = toPickerValue(START_ISO);
    expect(fromPickerValue(picker)).toBe(START_ISO);
    // 无论运行环境本地时区，钟面时间都按 Asia/Shanghai 解释
    const typed = dayjs('2026-11-20 10:00:00');
    expect(fromPickerValue(typed)).toBe(START_ISO);
  });

  it('拼团创建/编辑载荷：金额与人数直传，编辑带 version 且不含 courseId', () => {
    // 表单值
    const values = {
      courseId: 2,
      name: ' 三人成团 ',
      priceCents: 9900,
      targetSize: 3,
      startAt: toPickerValue(START_ISO),
      endAt: toPickerValue(END_ISO),
    };

    expect(toGrouponCreatePayload(values)).toEqual({
      courseId: 2,
      name: '三人成团',
      priceCents: 9900,
      targetSize: 3,
      startAt: START_ISO,
      endAt: END_ISO,
    });
    expect(toGrouponUpdatePayload(values, 7)).toEqual({
      version: 7,
      name: '三人成团',
      priceCents: 9900,
      targetSize: 3,
      startAt: START_ISO,
      endAt: END_ISO,
    });
  });

  it('秒杀创建/编辑载荷：库存直传，编辑带 version', () => {
    // 表单值
    const values = {
      courseId: 2,
      name: '限时秒杀',
      priceCents: 4900,
      stock: 50,
      startAt: toPickerValue(START_ISO),
      endAt: toPickerValue(END_ISO),
    };

    expect(toFlashSaleCreatePayload(values)).toEqual({
      courseId: 2,
      name: '限时秒杀',
      priceCents: 4900,
      stock: 50,
      startAt: START_ISO,
      endAt: END_ISO,
    });
    expect(toFlashSaleUpdatePayload(values, 4)).toMatchObject({
      version: 4,
      stock: 50,
    });
  });

  it('优惠券创建固定 perUserLimit=1、默认不停用；编辑带 version', () => {
    // 表单值
    const values = {
      name: '满 100 减 20',
      discountCents: 2000,
      startAt: toPickerValue(START_ISO),
      endAt: toPickerValue(END_ISO),
      totalQty: 100,
      courseIds: [2],
      enableOnCreate: false,
    };

    expect(toCouponCreatePayload(values)).toEqual({
      name: '满 100 减 20',
      discountCents: 2000,
      startAt: START_ISO,
      endAt: END_ISO,
      totalQty: 100,
      perUserLimit: 1,
      courseIds: [2],
      enableOnCreate: false,
    });
    expect(toCouponUpdatePayload(values, 3)).toEqual({
      version: 3,
      name: '满 100 减 20',
      discountCents: 2000,
      startAt: START_ISO,
      endAt: END_ISO,
      totalQty: 100,
      courseIds: [2],
    });
  });

  it('优惠券详情回填为表单值', () => {
    // 详情桩
    const template = {
      id: 9,
      name: '满 100 减 20',
      discountCents: 2000,
      startAt: START_ISO,
      endAt: END_ISO,
      totalQty: 100,
      claimedCount: 5,
      status: 'disabled' as const,
      courseIds: [2],
      version: 3,
    };

    expect(toCouponFormValues(template)).toMatchObject({
      name: '满 100 减 20',
      discountCents: 2000,
      totalQty: 100,
      courseIds: [2],
    });
  });

  it('早于当前日期的日期不可选，当天保留可选的未来时刻', () => {
    // 当前时刻桩：上海时间 2026-11-14 20:30:45
    const now = toPickerValue('2026-11-14T12:30:45.000Z');

    expect(disabledPastDate(now.subtract(1, 'day'), now)).toBe(true);
    expect(disabledPastDate(now, now)).toBe(false);
    expect(disabledPastDate(now.add(1, 'day'), now)).toBe(false);
  });

  it('当天早于当前时刻的时分秒被禁用，其他日期不限制', () => {
    // 当前时刻桩：上海时间 2026-11-14 20:30:45
    const now = toPickerValue('2026-11-14T12:30:45.000Z');

    // 无值或其他日期不限制
    expect(disabledPastTime(null, now)).toEqual({});
    expect(disabledPastTime(now.add(1, 'day'), now)).toEqual({});

    // 当天：20 点前、20:30 前、20:30:45 前不可选
    const config = disabledPastTime(now, now);
    expect(config.disabledHours?.()).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
    expect(config.disabledMinutes?.(20)).toEqual(
      Array.from({ length: 30 }, (_, index) => index),
    );
    expect(config.disabledSeconds?.(20, 30)).toEqual(
      Array.from({ length: 45 }, (_, index) => index),
    );
    expect(config.disabledMinutes?.(21)).toEqual([]);
    expect(config.disabledSeconds?.(20, 31)).toEqual([]);
  });
});
