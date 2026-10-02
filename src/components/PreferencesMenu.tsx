import {
  GearSixIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from '@phosphor-icons/react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIdentity } from '@/lib/identity';
import { useMotion } from '@/providers/MotionProvider';
import { useTheme } from '@/providers/ThemeProvider';

/** Theme, motion and your name. Per device, nothing here touches a board. */
export function PreferencesMenu() {
  const { theme, toggle } = useTheme();
  const motion = useMotion();
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
            <DropdownMenuItem closeOnClick={false} onClick={toggle}>
              <span key={theme} className="theme-icon inline-flex">
                {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
              </span>
              <span className="flex-1">Theme</span>
              <span className="text-muted-foreground capitalize">{theme}</span>
            </DropdownMenuItem>
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
