import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ActivityMainContent() {
  const { t } = useTranslation("navigation");

  return (
    <main className="flex-1 flex flex-col bg-white dark:bg-background items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto mb-4">
          <Bell size={32} className="text-purple-600 dark:text-purple-400" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-foreground mb-2">
          {t("selectActivity")}
        </h2>
        <p className="text-slate-600 dark:text-muted-foreground">
          {t("selectActivityDescription")}
        </p>
      </div>
    </main>
  );
}
