import { describe, expect, test } from 'bun:test';
import type { EntityDetailResponse } from '@omm/shared';
import { formatEntityDetailsText } from './CasefileDrawer';

const details: EntityDetailResponse = {
  entity: {
    id: 'wd:Q1',
    type: 'author',
    names: { labels: { zh: '阿加莎·克里斯蒂', en: 'Agatha Christie' } },
    bio: '英国推理小说家。',
    birth: '+1890-09-15T00:00:00Z',
    country: '英国',
  },
  facts: [
    { subject_id: 'wd:Q1', predicate: '创作', object_ref: 'wd:Q2', object_value: '东方快车谋杀案' },
    { subject_id: 'wd:Q1', predicate: '创作', object_ref: 'wd:Q2', object_value: '东方快车谋杀案' },
    { subject_id: 'wd:Q1', predicate: 'award_received', object_ref: 'wd:Q3' },
  ],
  recommendations: [],
};

describe('CasefileDrawer copy text', () => {
  test('formats concise entity data and deduplicates relations', () => {
    expect(formatEntityDetailsText(details)).toBe(
      [
        '名称：阿加莎·克里斯蒂',
        '类型：作者',
        '英文名：Agatha Christie',
        '简介：英国推理小说家。',
        '生卒：1890 ~ 至今',
        '国籍：英国',
        '',
        '关系：',
        '创作：东方快车谋杀案',
        '奖项：wd:Q3',
        '来源 ID：wd:Q1',
      ].join('\n'),
    );
  });
});
