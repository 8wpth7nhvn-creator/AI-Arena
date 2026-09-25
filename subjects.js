// Subject registry. To add a subject: add an entry here and a challenge file
// in ./challenges/ that is registered in ./challenges/index.js.

export const SUBJECTS = [
  {
    id: 'cs',
    name: 'Computer Science',
    icon: '💻',
    description: 'Debug programs, trace logic, and argue about algorithms.',
    color: '#38bdf8',
  },
  {
    id: 'biology',
    name: 'Biology',
    icon: '🧬',
    description: 'Question claims about living things with scientific reasoning.',
    color: '#4ade80',
  },
  {
    id: 'history',
    name: 'History',
    icon: '🏛️',
    description: 'Untangle causes, weigh evidence, and challenge simple stories.',
    color: '#fbbf24',
  },
  {
    id: 'psychology',
    name: 'Psychology',
    icon: '🧠',
    description: 'Compare hypotheses that explain how people think and act.',
    color: '#f472b6',
  },
  {
    id: 'economics',
    name: 'Economics',
    icon: '📈',
    description: 'Take apart confident claims about prices, trade, and money.',
    color: '#a78bfa',
  },
];

export function getSubject(id) {
  return SUBJECTS.find((s) => s.id === id) || null;
}
