import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it } from 'vitest';
import { SessionParticipationProfileDialogComponent } from './session-participation-profile-dialog.component';

describe('SessionParticipationProfileDialogComponent', () => {
  function createComponent() {
    TestBed.configureTestingModule({
      imports: [SessionParticipationProfileDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            identityMode: 'PRESET_PSEUDONYM',
            nicknameTheme: 'KINDERGARTEN',
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close: () => undefined },
        },
      ],
    });
    const fixture = TestBed.createComponent(SessionParticipationProfileDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('bietet alle drei Identitätsmodi mit kurzem Anonym-Hinweis', () => {
    const fixture = createComponent();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('mat-radio-button')).toHaveLength(3);
    expect(host.textContent).toContain('Namensdarstellung');
    expect(host.textContent).not.toContain('Teilnahme für Q&A');
    expect(host.textContent).toContain('Vorgegebene Pseudonyme');
    expect(host.textContent).toContain('Eigener Nickname');
    expect(host.textContent).toContain('Anonym');
    expect(host.textContent).not.toContain('Anonymmodus');
    expect(host.textContent).toContain('Beiträge erscheinen ohne sichtbare Verfasserangabe');
    expect(host.textContent).not.toContain('keine vollständige Anonymisierung');
    expect(host.textContent).not.toContain('Lege fest, wie Personen');
    expect(host.textContent).not.toContain('Nach dem ersten erfolgreichen Beitritt');
    expect(host.textContent).not.toContain('Schritt 1 von 2');
  });

  it('zeigt die Sequenznummer beim Anlegen von der Startseite', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SessionParticipationProfileDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            identityMode: 'PRESET_PSEUDONYM',
            nicknameTheme: 'KINDERGARTEN',
            setupStep: 1,
            setupStepCount: 2,
          },
        },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(SessionParticipationProfileDialogComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Schritt 1 von 2');
  });

  it('liefert Modus und Pseudonymgruppe gemeinsam zurück', () => {
    const fixture = createComponent();
    fixture.componentInstance.identityMode.set('CUSTOM_NICKNAME');
    fixture.componentInstance.nicknameTheme.set('MIDDLE_SCHOOL');

    expect(fixture.componentInstance.result()).toEqual({
      identityMode: 'CUSTOM_NICKNAME',
      nicknameTheme: 'MIDDLE_SCHOOL',
    });
  });

  it('beschreibt die Pseudonymgruppen nach ihrem Inhalt', () => {
    const fixture = createComponent();
    const select = fixture.nativeElement.querySelector('mat-select') as HTMLElement;
    select.click();
    fixture.detectChanges();

    const options = [...document.querySelectorAll('mat-option')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(options).toEqual([
      'Bunte Tier-Icons',
      'Märchenfiguren',
      'Entdecker und Superhelden',
      'Philosophen und Forscher',
      'Nobelpreisträger:innen',
    ]);
  });

  it('zeigt die Pseudonymgruppe nur für vorgegebene Pseudonyme', () => {
    const fixture = createComponent();
    expect(fixture.nativeElement.querySelector('mat-select')).not.toBeNull();

    fixture.componentInstance.identityMode.set('ANONYMOUS');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
  });
});
