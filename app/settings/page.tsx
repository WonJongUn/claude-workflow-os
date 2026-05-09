import { NotificationSoundSettings } from "../components/NotificationSoundSettings";
import { SettingsForm } from "../components/SettingsForm";

export default function SettingsPage() {
  return (
    <div className="flex w-full flex-col gap-6 py-6 pl-8 pr-16 2xl:pl-12 2xl:pr-20">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          설정
        </h1>
        <p className="text-xs text-zinc-500">
          앱 전역 설정. 변경 사항은 즉시 저장됩니다.
        </p>
      </header>
      <SettingsForm />
      <NotificationSoundSettings />
    </div>
  );
}
