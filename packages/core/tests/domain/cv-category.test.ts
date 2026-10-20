import { describe, expect, it } from 'vitest';
import {
  CV_CATEGORIES,
  suggestCvCategory,
  type CvCategory,
} from '../../src/domain/cv-category.js';

function suggest(title: string, description = '') {
  return suggestCvCategory({ title, description });
}

describe('suggestCvCategory - no evidence', () => {
  it('falls back to General with no_evidence and no terms', () => {
    expect(suggest('Desarrollador de software', 'Buscamos a alguien con ganas.')).toEqual({
      category: 'general',
      matchedTerms: [],
      reason: 'no_evidence',
    });
  });

  it('handles an entirely empty offer', () => {
    expect(suggest('', '')).toEqual({ category: 'general', matchedTerms: [], reason: 'no_evidence' });
  });
});

describe('suggestCvCategory - every category', () => {
  const cases: readonly [CvCategory, string, string, readonly string[]][] = [
    ['java_spring_backend', 'Desarrollador Java', 'Spring Boot, Hibernate y Maven.', ['java', 'spring boot', 'hibernate', 'maven']],
    ['full_stack', 'Desarrollador Full Stack', 'Trabajo en equipo.', ['full stack']],
    ['python_data_ai', 'Data Scientist', 'Python, pandas y machine learning.', ['python', 'pandas', 'machine learning', 'data scientist']],
    ['frontend', 'Desarrollador Frontend', 'React, TypeScript y Tailwind.', ['react', 'typescript', 'tailwind', 'frontend']],
    ['qa_testing', 'QA Tester', 'Selenium, Cypress y pruebas funcionales.', ['qa', 'tester', 'selenium', 'cypress', 'pruebas funcionales']],
    ['microsoft_power_platform', 'Consultor Power Platform', 'Power Apps, Power Automate y Dataverse.', ['power apps', 'power platform', 'power automate', 'dataverse']],
  ];

  for (const [category, title, description, terms] of cases) {
    it(`suggests ${category} with the matched terms as evidence`, () => {
      const result = suggest(title, description);
      expect(result.category).toBe(category);
      expect(result.reason).toBe('evidence');
      expect([...result.matchedTerms].sort()).toEqual([...terms].sort());
      expect(result.tiedCategories).toBeUndefined();
    });
  }

  it('exposes the six evidence categories plus general', () => {
    expect([...CV_CATEGORIES]).toEqual([
      'java_spring_backend',
      'full_stack',
      'python_data_ai',
      'frontend',
      'qa_testing',
      'microsoft_power_platform',
      'general',
    ]);
  });

  it('recognises .NET, C# and Microsoft 365 as Microsoft', () => {
    const result = suggest('Desarrollador C# .NET', 'ASP.NET y Microsoft 365.');
    expect(result.category).toBe('microsoft_power_platform');
    expect(result.matchedTerms).toEqual(expect.arrayContaining(['c#', 'asp.net', 'microsoft 365']));
    expect(result.matchedTerms).not.toContain('.net');
  });
});

describe('suggestCvCategory - nested terms count one signal', () => {
  it('keeps "spring boot" and drops the nested "spring"', () => {
    expect(suggest('Java Spring Boot', '')).toEqual({
      category: 'java_spring_backend',
      matchedTerms: ['java', 'spring boot'],
      reason: 'evidence',
    });
  });

  it('keeps "asp.net" and drops the nested ".net"', () => {
    expect(suggest('ASP.NET C#', '')).toEqual({
      category: 'microsoft_power_platform',
      matchedTerms: ['asp.net', 'c#'],
      reason: 'evidence',
    });
  });

  it('keeps "vue.js" and drops the nested "vue"', () => {
    expect(suggest('Vue.js TypeScript', '')).toEqual({
      category: 'frontend',
      matchedTerms: ['vue.js', 'typescript'],
      reason: 'evidence',
    });
  });

  it('keeps a bare "spring" when no longer term contains it', () => {
    expect(suggest('Java Spring', '').matchedTerms).toEqual(['java', 'spring']);
  });

  it('does not let one nested signal change the winner', () => {
    // One Spring Boot signal (java + spring boot = 2) must tie two Python
    // signals, not beat them with a phantom third term.
    const result = suggest('Java Spring Boot', 'Python y pandas.');
    expect(result.reason).toBe('tie');
    expect(result.tiedCategories).toEqual(['java_spring_backend', 'python_data_ai']);
  });

  it('never drops a term across categories', () => {
    const result = suggest('Java JavaScript', '');
    expect(result.reason).toBe('tie');
    expect(result.tiedCategories).toEqual(['java_spring_backend', 'frontend']);
  });
});

describe('suggestCvCategory - normalization', () => {
  it('ignores case and accents in the offer and in Spanish terms', () => {
    const result = suggest('INGENIERO TESTER', 'Automatización de pruebas con CYPRESS.');
    expect(result.category).toBe('qa_testing');
    expect(result.matchedTerms).toEqual(
      expect.arrayContaining(['tester', 'automatizacion de pruebas', 'cypress']),
    );
  });

  it('matches the accented Spanish AI term', () => {
    const result = suggest('Especialista', 'Proyectos de Inteligencia Artificial.');
    expect(result.category).toBe('python_data_ai');
    expect(result.matchedTerms).toEqual(['inteligencia artificial']);
  });

  it('matches punctuation-heavy terms', () => {
    expect(suggest('Dev', 'Experiencia en Next.js y Vue.js.').category).toBe('frontend');
    expect(suggest('Dev', 'Experiencia en Scikit-Learn.').matchedTerms).toEqual(['scikit-learn']);
    expect(suggest('Dev', 'Front-end developer').matchedTerms).toEqual(['front-end']);
  });
});

describe('suggestCvCategory - distinct terms', () => {
  it('counts a repeated term once, so a single repeated word cannot beat two distinct ones', () => {
    const result = suggest(
      'Java Java Java',
      'java java java java java. Python y pandas para análisis.',
    );
    expect(result.category).toBe('python_data_ai');
    expect(result.matchedTerms).toEqual(['python', 'pandas']);
  });

  it('ties when two categories have the same number of distinct terms despite repetition', () => {
    const result = suggest('Java', 'java java java python python python');
    expect(result.category).toBe('general');
    expect(result.reason).toBe('tie');
  });
});

describe('suggestCvCategory - tie', () => {
  it('returns General/tie with the tied categories in deterministic order', () => {
    const result = suggest('Desarrollador React', 'Experiencia en Python.');
    expect(result).toEqual({
      category: 'general',
      matchedTerms: [],
      reason: 'tie',
      tiedCategories: ['python_data_ai', 'frontend'],
    });
  });

  it('orders tied categories the same regardless of mention order', () => {
    const a = suggest('Cypress y Java', '');
    const b = suggest('Java y Cypress', '');
    expect(a.tiedCategories).toEqual(['java_spring_backend', 'qa_testing']);
    expect(b.tiedCategories).toEqual(['java_spring_backend', 'qa_testing']);
  });

  it('does not report categories below the top score as tied', () => {
    const result = suggest('Java React', 'Python y pandas, Cypress.');
    expect(result.category).toBe('python_data_ai');
    expect(result.reason).toBe('evidence');
  });

  it('lists three tied categories when three share the top score', () => {
    const result = suggest('Java, Python y React', '');
    expect(result.tiedCategories).toEqual(['java_spring_backend', 'python_data_ai', 'frontend']);
  });
});

describe('suggestCvCategory - explicit full stack', () => {
  it.each(['full stack', 'full-stack', 'fullstack', 'Full Stack', 'FULLSTACK'])(
    'treats "%s" as a decisive marker',
    (marker) => {
      const result = suggest(`Desarrollador ${marker}`, 'Java, Spring Boot, Hibernate y Maven.');
      expect(result.category).toBe('full_stack');
      expect(result.reason).toBe('evidence');
      expect(result.matchedTerms).toHaveLength(1);
    },
  );

  it('wins over many ordinary stack terms from another category', () => {
    const result = suggest('Fullstack Developer', 'React, Angular, Vue, TypeScript, JavaScript, HTML, CSS.');
    expect(result.category).toBe('full_stack');
    expect(result.matchedTerms).toEqual(['fullstack']);
  });

  it('never infers Full stack from frontend plus backend terms', () => {
    const result = suggest('Desarrollador', 'React, TypeScript, Java, Spring Boot y Hibernate.');
    expect(result.category).not.toBe('full_stack');
    expect(result.category).toBe('java_spring_backend');
  });

  it('never infers Full stack when frontend and backend tie', () => {
    const result = suggest('Desarrollador', 'React y Java.');
    expect(result.category).toBe('general');
    expect(result.reason).toBe('tie');
    expect(result.tiedCategories).not.toContain('full_stack');
  });
});

describe('suggestCvCategory - boundaries and ambiguous words', () => {
  it('does not read java inside javascript', () => {
    const result = suggest('Desarrollador JavaScript', '');
    expect(result.category).toBe('frontend');
    expect(result.matchedTerms).toEqual(['javascript']);
  });

  it.each([
    'test',
    'testing',
    'pruebas',
    'power',
    'AI',
    'IA',
    'data',
    'datos',
    'UI',
    'API',
    'REST',
    'SQL',
    'Azure',
    'backend',
    'JUnit',
    'Jest',
  ])('does not count the bare word "%s" as evidence', (word) => {
    expect(suggest(`Desarrollador ${word}`, `Trabajo con ${word} a diario.`)).toEqual({
      category: 'general',
      matchedTerms: [],
      reason: 'no_evidence',
    });
  });

  it('does not confuse Power BI with Python/data/AI', () => {
    const result = suggest('Analista Power BI', 'Informes y datos con data models.');
    expect(result.category).toBe('microsoft_power_platform');
    expect(result.matchedTerms).toEqual(['power bi']);
  });

  it('does not match a term inside a longer word', () => {
    expect(suggest('Qatar developer', 'Reactive systems, scripting.').reason).toBe('no_evidence');
  });
});

describe('suggestCvCategory - input contract and output shape', () => {
  it('ignores company and location because the function reads only title and description', () => {
    const extra = { title: 'Desarrollador', description: '', company: 'Java Python SA', location: 'React Street' };
    expect(suggestCvCategory(extra)).toEqual({
      category: 'general',
      matchedTerms: [],
      reason: 'no_evidence',
    });
  });

  it('never exposes a model id, a path or registry data', () => {
    const outputs = [
      suggest('Desarrollador Java', 'Spring'),
      suggest('Java y React', ''),
      suggest('Nada', ''),
      suggest('Full stack', ''),
    ];
    for (const output of outputs) {
      const keys = Object.keys(output);
      expect(keys).not.toContain('modelId');
      expect(keys).not.toContain('path');
      expect(keys).not.toContain('model');
      const serialised = JSON.stringify(output);
      expect(serialised).not.toMatch(/\.pdf|modelId|relativePath|registry|cv-models/i);
    }
  });

  it('is deterministic for the same input', () => {
    expect(suggest('Java y React', '')).toEqual(suggest('Java y React', ''));
  });
});
