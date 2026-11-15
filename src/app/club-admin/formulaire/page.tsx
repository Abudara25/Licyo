import { requireClubContext } from '@/lib/db/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { RegistrationFormEditor } from '@/components/club-admin/RegistrationFormEditor';
import { getSportPreset } from '@/config/sports-presets';
import { editableSettings, parseFormConfig } from '@/config/registration-fields';

export default async function RegistrationFormPage() {
  const { club } = await requireClubContext('settings.manage');
  const preset = getSportPreset(club.sport_type);
  const config = parseFormConfig(club.registration_form);
  // Les options calculées selon le sport (fonctions) ne passent pas au composant client : seuls les réglages comptent ici.
  const rows = editableSettings(config, club.sport_type, preset.family).map(({ field, setting }) => {
    const { options: _options, ...plain } = field;
    return { field: plain, setting };
  });
  return (
    <>
      <PageHeader
        title="Formulaire d’inscription"
        description={`Choisissez les informations demandées aux familles et aux adhérents (${preset.label}).`}
      />
      <RegistrationFormEditor rows={rows} custom={config.custom} />
    </>
  );
}
