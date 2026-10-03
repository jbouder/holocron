import { GearSixIcon, UserIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { NameDialog } from '@/components/NameDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIdentity } from '@/lib/identity';
import { isThemeId, THEMES } from '@/lib/themes';
import { setTimerSound, useTimerSound } from '@/lib/timer-alert';
import { useMotion } from '@/providers/MotionProvider';
import { useTheme } from '@/providers/ThemeProvider';

/** Theme, motion, timer sound and your name. Per device, nothing here touches a board. */
export function PreferencesMenu() {
  const { theme, setTheme } = useTheme();
  const motion = useMotion();
  const timerSound = useTimerSound();
  const identity = useIdentity();
  const [naming, setNaming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="press"
              aria-label="Preferences"
            />
          }
        >
          <GearSixIcon weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Preferences</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              closeOnClick={false}
              checked={motion.preference}
              disabled={motion.reduced}
              onCheckedChange={(on) => motion.setPreference(on)}
            >
              <span className="flex-1">Motion</span>
              {motion.reduced && (
                <span className="text-muted-foreground">off by your OS</span>
              )}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              closeOnClick={false}
              checked={timerSound}
              onCheckedChange={(on) => setTimerSound(on)}
            >
              Timer sound
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (isThemeId(value)) setTheme(value);
              }}
            >
              {THEMES.map((t) => (
                <DropdownMenuRadioItem
                  key={t.id}
                  value={t.id}
                  closeOnClick={false}
                >
                  {t.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setNaming(true)}>
              <UserIcon />
              <span className="flex-1">Your name</span>
              <span className="max-w-24 truncate text-muted-foreground">
                {identity.name || 'not set'}
              </span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog open={naming} onOpenChange={setNaming} />
    </>
  );
}
