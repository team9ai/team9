import { describe, expect, it } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { UpdateRoutineDto } from './update-routine.dto.js';

describe('UpdateRoutineDto', () => {
  it('preserves schedule trigger config under the gateway whitelist validation pipe', async () => {
    const pipe = new ValidationPipe({ whitelist: true });

    const result = (await pipe.transform(
      {
        triggers: [
          {
            type: 'schedule',
            config: {
              frequency: 'daily',
              time: '09:00',
              timezone: 'Asia/Shanghai',
            },
          },
        ],
      },
      { type: 'body', metatype: UpdateRoutineDto },
    )) as UpdateRoutineDto;

    expect(result.triggers?.[0]?.config).toEqual({
      frequency: 'daily',
      time: '09:00',
      timezone: 'Asia/Shanghai',
    });
  });
});
