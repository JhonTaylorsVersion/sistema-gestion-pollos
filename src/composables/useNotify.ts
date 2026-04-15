import { ref } from "vue";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastState {
  show: boolean;
  message: string;
  type: ToastType;
}

const toast = ref<ToastState>({
  show: false,
  message: "",
  type: "success",
});

const draggingToast = ref(false);
const toastY = ref(0);
const startY = ref(0);

export function useNotify() {
  const handleToastMouseDown = (e: MouseEvent) => {
    draggingToast.value = true;
    startY.value = e.clientY;
    document.addEventListener("mousemove", handleToastMouseMove);
    document.addEventListener("mouseup", handleToastMouseUp);
  };

  const handleToastMouseMove = (e: MouseEvent) => {
    if (!draggingToast.value) return;
    toastY.value = e.clientY - startY.value;
  };

  const handleToastMouseUp = () => {
    if (!draggingToast.value) return;
    draggingToast.value = false;

    if (Math.abs(toastY.value) > 60) {
      toast.value.show = false;
    }

    toastY.value = 0;
    document.removeEventListener("mousemove", handleToastMouseMove);
    document.removeEventListener("mouseup", handleToastMouseUp);
  };

  const mostrarToast = (message: string, type: ToastType = "success") => {
    toast.value.message = message;
    toast.value.type = type;
    toast.value.show = true;
    toastY.value = 0;

    setTimeout(() => {
      if (!draggingToast.value) {
        toast.value.show = false;
      }
    }, 4500);
  };

  return {
    toast,
    toastY,
    draggingToast,
    mostrarToast,
    handleToastMouseDown,
  };
}
