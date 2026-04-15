import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
  Matches,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_-]+$/, {
    message:
      'Username can only contain lowercase letters, numbers, underscores, and hyphens',
  })
  @IsOptional()
  username?: string;

  /**
   * IETF BCP 47 language tag (e.g. "en", "zh-CN", "ja"). Populated by the
   * client on authenticated bootstrap — the gateway reads this when
   * composing bootstrap event payloads so agents greet mentors in their
   * preferred language.
   *
   * Conservative regex: language-subtag-only or language-subtag-with-script
   * / region-subtag. Deliberately not matching the full BCP 47 grammar to
   * avoid an overly permissive pattern.
   */
  @IsString()
  @MaxLength(16)
  @Matches(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
    message:
      'Language must be an IETF BCP 47 tag (e.g. "en", "zh-CN", "pt-BR")',
  })
  @IsOptional()
  language?: string;

  /**
   * IANA time zone name (e.g. "Asia/Shanghai", "America/New_York"). Same
   * delivery model as `language` — client writes it on authenticated
   * bootstrap, gateway reads it for bootstrap event payloads.
   *
   * Conservative regex: one or more `/`-separated components made of
   * letters, digits, `+`, `-`, or `_`. This covers both region/city
   * ("Asia/Shanghai"), multi-component ("America/Argentina/Buenos_Aires"),
   * and offset-style ("Etc/GMT+8") names without accepting arbitrary
   * strings.
   */
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9+_-]+(\/[A-Za-z0-9+_-]+)*$/, {
    message:
      'Time zone must be an IANA zone name (e.g. "Asia/Shanghai", "America/New_York", "UTC")',
  })
  @IsOptional()
  timeZone?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(['online', 'offline', 'away', 'busy'])
  status: 'online' | 'offline' | 'away' | 'busy';
}
