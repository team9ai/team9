import { Injectable } from '@nestjs/common';
import type {
  SearchQueryParser,
  ParsedSearchQuery,
  SearchFilters,
} from '../interfaces/index.js';

@Injectable()
export class Team9StyleQueryParser implements SearchQueryParser {
  parse(query: string): ParsedSearchQuery {
    const filters: SearchFilters = {};
    let text = query;

    // Extract from: filters (from:@username or from:username)
    const fromMatches = [...query.matchAll(/from:@?(\w+)/gi)];
    if (fromMatches.length > 0) {
      filters.from = fromMatches.map((m) => m[1]);
      text = text.replace(/from:@?\w+/gi, '');
    }

    // Extract in: filters (in:#channel or in:channel)
    const inMatches = [...query.matchAll(/in:#?(\w+)/gi)];
    if (inMatches.length > 0) {
      filters.in = inMatches.map((m) => m[1]);
      text = text.replace(/in:#?\w+/gi, '');
    }

    // Extract before: filter (before:2024-01-01)
    const beforeMatch = query.match(/before:(\d{4}-\d{2}-\d{2})/i);
    if (beforeMatch) {
      const date = new Date(beforeMatch[1]);
      if (!isNaN(date.getTime())) {
        filters.before = date;
      }
      text = text.replace(/before:\d{4}-\d{2}-\d{2}/gi, '');
    }

    // Extract after: filter (after:2024-01-01)
    const afterMatch = query.match(/after:(\d{4}-\d{2}-\d{2})/i);
    if (afterMatch) {
      const date = new Date(afterMatch[1]);
      if (!isNaN(date.getTime())) {
        filters.after = date;
      }
      text = text.replace(/after:\d{4}-\d{2}-\d{2}/gi, '');
    }

    // Extract during: filter (during:today|week|month|year)
    const duringMatch = query.match(/during:(today|week|month|year)/i);
    if (duringMatch) {
      filters.during = duringMatch[1].toLowerCase() as
        | 'today'
        | 'week'
        | 'month'
        | 'year';
      this.applyDuringFilter(filters);
      text = text.replace(/during:(today|week|month|year)/gi, '');
    }

    // Extract has: filters (has:file|image|link|reaction)
    const hasMatches = [...query.matchAll(/has:(file|image|link|reaction)/gi)];
    if (hasMatches.length > 0) {
      filters.has = hasMatches.map(
        (m) => m[1].toLowerCase() as 'file' | 'image' | 'link' | 'reaction',
      );
      text = text.replace(/has:(file|image|link|reaction)/gi, '');
    }

    // Extract is: filters (is:pinned|thread|dm)
    const isMatches = [...query.matchAll(/is:(pinned|thread|dm)/gi)];
    if (isMatches.length > 0) {
      filters.is = isMatches.map(
        (m) => m[1].toLowerCase() as 'pinned' | 'thread' | 'dm',
      );
      text = text.replace(/is:(pinned|thread|dm)/gi, '');
    }

    // Extract type: filters (type:message|channel|user|file)
    const typeMatches = [
      ...query.matchAll(/type:(message|channel|user|file)/gi),
    ];
    if (typeMatches.length > 0) {
      filters.type = typeMatches.map(
        (m) => m[1].toLowerCase() as 'message' | 'channel' | 'user' | 'file',
      );
      text = text.replace(/type:(message|channel|user|file)/gi, '');
    }

    // Clean up the text: remove extra spaces
    text = text.trim().replace(/\s+/g, ' ');

    return {
      text,
      filters,
    };
  }

  private applyDuringFilter(filters: SearchFilters): void {
    const now = new Date();

    switch (filters.during) {
      case 'today':
        filters.after = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        filters.after = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        filters.after = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        filters.after = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        break;
    }
  }
}
