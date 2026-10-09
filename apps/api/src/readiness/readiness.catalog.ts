export const READINESS_PARAMETERS = [
  { key: 'hundred_days_training', label: 'Hundred Days Training', maxScore: 15 },
  { key: 'foreign_language', label: 'Foreign Language', maxScore: 15 },
  { key: 'gate_higher_studies', label: 'GATE & Higher Studies', maxScore: 25 },
  { key: 'competitions_hackathons', label: 'Competitions & Hackathons', maxScore: 20 },
  { key: 'internship_startup', label: 'Internship & Startup', maxScore: 20 },
  { key: 'industry_academic_certificates', label: 'Industry & Academic Certificates', maxScore: 20 },
  { key: 'aptitude_communication', label: 'Aptitude & Communication', maxScore: 20 },
  { key: 'coding_problems', label: 'Coding Problems', maxScore: 25 },
  { key: 'competitive_rating', label: 'Competitive Rating', maxScore: 20 },
  { key: 'open_source_contributions', label: 'Open Source Contributions', maxScore: 20 },
  { key: 'monthly_coding_assessment', label: 'Monthly Coding Assessment', maxScore: 20 },
  { key: 'project_publication_patent', label: 'Project / Publication / Patent', maxScore: 30 },
] as const;

export const READINESS_MAX_SCORE = READINESS_PARAMETERS.reduce((total, parameter) => total + parameter.maxScore, 0);
