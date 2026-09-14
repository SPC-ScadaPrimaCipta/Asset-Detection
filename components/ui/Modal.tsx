import { createPortal } from "react-dom";
import { ReactNode, useEffect, useState } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  if (!isOpen || !isClient) return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl max-w-2xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {title && <div className="p-4 border-b font-semibold">{title}</div>}
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
