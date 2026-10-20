import { describe, expect, it } from 'vitest';
import { CV_CATEGORIES, suggestCvCategory, type CvCategory } from '@job-queue/core';
import { ES } from '@/copy/es';
import { describeCvCategorySuggestion } from '@/components/cv-category-copy';

describe('cv category copy', () => {
  it('has a Spanish name for every category', () => {
    for (const category of CV_CATEGORIES) {
      expect(ES.cvCategory.names[category].length).toBeGreaterThan(0);
    }
    expect(ES.cvCategory.names).toEqual({
      java_spring_backend: 'Java / Spring backend',
      full_stack: 'Full stack',
      python_data_ai: 'Python / datos / IA',
      frontend: 'Frontend',
      qa_testing: 'QA / testing',
      microsoft_power_platform: 'Microsoft / Power Platform',
      general: 'General',
    } satisfies Record<CvCategory, string>);
  });

  it('uses the required heading and disclaimer', () => {
    const view = describeCvCategorySuggestion({
      category: 'frontend',
      matchedTerms: ['react'],
      reason: 'evidence',
    });
    expect(view.heading).toBe('Categoría de CV sugerida');
    expect(view.disclaimer).toBe('Orientativa: no selecciona ni asigna ningún modelo de CV.');
  });

  it('lists the detected terms for evidence', () => {
    const view = describeCvCategorySuggestion({
      category: 'java_spring_backend',
      matchedTerms: ['java', 'spring boot'],
      reason: 'evidence',
    });
    expect(view.categoryName).toBe('Java / Spring backend');
    expect(view.explanation).toBe('Términos detectados: java, spring boot');
  });

  it('explains the absence of evidence', () => {
    const view = describeCvCategorySuggestion(suggestCvCategory({ title: 'Dev', description: '' }));
    expect(view.categoryName).toBe('General');
    expect(view.explanation).toBe('Sin evidencia suficiente en el título ni en la descripción.');
  });

  it('names the tied categories in Spanish', () => {
    const two = describeCvCategorySuggestion(
      suggestCvCategory({ title: 'Java', description: 'React' }),
    );
    expect(two.categoryName).toBe('General');
    expect(two.explanation).toBe('Empate entre Java / Spring backend y Frontend');

    const three = describeCvCategorySuggestion({
      category: 'general',
      matchedTerms: [],
      reason: 'tie',
      tiedCategories: ['java_spring_backend', 'python_data_ai', 'frontend'],
    });
    expect(three.explanation).toBe(
      'Empate entre Java / Spring backend, Python / datos / IA y Frontend',
    );
  });

  it('never mentions a PDF or a registry model', () => {
    const views = [
      describeCvCategorySuggestion({ category: 'qa_testing', matchedTerms: ['qa'], reason: 'evidence' }),
      describeCvCategorySuggestion({ category: 'general', matchedTerms: [], reason: 'no_evidence' }),
    ];
    for (const view of views) {
      expect(JSON.stringify(view)).not.toMatch(/\.pdf|modelo registrado|registro/i);
    }
  });
});
