import { AppShell } from '@/components/AppShell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MotionProvider } from '@/providers/MotionProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { ToastProvider } from '@/providers/ToastProvider';

export default function App() {
  return (
    <MotionProvider>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <AppShell />
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MotionProvider>
  );
}
