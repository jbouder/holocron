export interface Template {
  id: string;
  name: string;
  description: string;
  columns: string[];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'classic',
    name: 'Went well / To improve',
    description: 'The default. What worked, what did not, what to do about it.',
    columns: ['Went well', 'To improve', 'Action items'],
  },
  {
    id: 'start-stop-continue',
    name: 'Start / Stop / Continue',
    description:
      'Three verbs. Good when the team wants decisions, not feelings.',
    columns: ['Start', 'Stop', 'Continue'],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad / Sad / Glad',
    description: 'Lead with how people felt about the sprint.',
    columns: ['Mad', 'Sad', 'Glad'],
  },
  {
    id: 'four-ls',
    name: '4Ls',
    description: 'Liked, Learned, Lacked, Longed for.',
    columns: ['Liked', 'Learned', 'Lacked', 'Longed for'],
  },
  {
    id: 'dagobah',
    name: 'Dagobah',
    description: 'Do. Or do not. There is no try. (But list the tries anyway.)',
    columns: ['Do', 'Do not', 'Try'],
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'One empty column. Add your own.',
    columns: ['Column 1'],
  },
];

export const DEFAULT_TEMPLATE_ID = 'classic';

export function findTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
