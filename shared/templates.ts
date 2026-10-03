export interface Template {
  id: string;
  name: string;
  description: string;
  /** Column titles and the one-line prompt shown under each. */
  columns: { title: string; prompt: string }[];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'classic',
    name: 'Went well / To improve',
    description: 'The default. What worked, what did not, what to do about it.',
    columns: [
      { title: 'Went well', prompt: 'What worked that we should keep?' },
      { title: 'To improve', prompt: 'What slowed us down or got in the way?' },
      {
        title: 'Action items',
        prompt: 'What will we do differently next time?',
      },
    ],
  },
  {
    id: 'start-stop-continue',
    name: 'Start / Stop / Continue',
    description:
      'Three verbs. Good when the team wants decisions, not feelings.',
    columns: [
      { title: 'Start', prompt: 'What should we begin doing?' },
      { title: 'Stop', prompt: 'What is not worth doing any more?' },
      { title: 'Continue', prompt: 'What is working and should stay?' },
    ],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad / Sad / Glad',
    description: 'Lead with how people felt about the sprint.',
    columns: [
      { title: 'Mad', prompt: 'What frustrated you?' },
      { title: 'Sad', prompt: 'What disappointed you?' },
      { title: 'Glad', prompt: 'What made you happy?' },
    ],
  },
  {
    id: 'four-ls',
    name: '4Ls',
    description: 'Liked, Learned, Lacked, Longed for.',
    columns: [
      { title: 'Liked', prompt: 'What did you enjoy?' },
      { title: 'Learned', prompt: 'What did you learn?' },
      { title: 'Lacked', prompt: 'What was missing?' },
      { title: 'Longed for', prompt: 'What did you wish you had?' },
    ],
  },
  {
    id: 'dagobah',
    name: 'Dagobah',
    description: 'Do. Or do not. There is no try. (But list the tries anyway.)',
    columns: [
      { title: 'Do', prompt: 'What should we commit to?' },
      { title: 'Do not', prompt: 'What should we drop?' },
      { title: 'Try', prompt: 'What experiment is worth a sprint?' },
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'One empty column. Add your own.',
    columns: [{ title: 'Column 1', prompt: '' }],
  },
];

export const DEFAULT_TEMPLATE_ID = 'classic';

export function findTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
