import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

interface DeleteMessageDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteMessageDialog({
  open,
  onConfirm,
  onCancel,
}: DeleteMessageDialogProps) {
  const { t } = useTranslation("message");
  const confirmedRef = useRef(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !confirmedRef.current) {
          onCancel();
        }
        confirmedRef.current = false;
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
            className={buttonVariants({ variant: "destructive" })}
          >
            {t("deleteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
