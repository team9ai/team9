import { ConfigType, registerAs } from '@nestjs/config';
import { plainToClass } from 'class-transformer';
import { IsNumber, IsString, IsOptional, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsNumber()
  PORT: number;

  // PostgreSQL Configuration
  @IsString()
  POSTGRES_USER: string;

  @IsString()
  POSTGRES_PASSWORD: string;

  @IsString()
  POSTGRES_DB: string;

  @IsNumber()
  DB_PORT: number;

  // Redis Configuration
  @IsString()
  REDIS_PASSWORD: string;

  @IsNumber()
  REDIS_PORT: number;

  // AI Service Configuration (defaults, can be overridden by database)
  @IsOptional()
  @IsString()
  AI_SERVICE_HOST?: string;

  @IsOptional()
  @IsNumber()
  AI_SERVICE_PORT?: number;
}

const appConfig = registerAs('appConfig', () => {
  const validatedConfig = plainToClass(EnvironmentVariables, process.env, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Config validation error: ${errors.toString()}`);
  }

  return {
    port: validatedConfig.PORT,
    database: {
      user: validatedConfig.POSTGRES_USER,
      password: validatedConfig.POSTGRES_PASSWORD,
      database: validatedConfig.POSTGRES_DB,
      port: validatedConfig.DB_PORT,
      host: 'localhost',
      get connectionString() {
        return `postgresql://${this.user}:${this.password}@${this.host}:${this.port}/${this.database}`;
      },
    },
    redis: {
      password: validatedConfig.REDIS_PASSWORD,
      port: validatedConfig.REDIS_PORT,
      host: 'localhost',
    },
    aiService: {
      host: validatedConfig.AI_SERVICE_HOST || 'localhost',
      port: validatedConfig.AI_SERVICE_PORT || 3001,
    },
  };
});

export type AppConfig = ConfigType<typeof appConfig>;

export default appConfig;
