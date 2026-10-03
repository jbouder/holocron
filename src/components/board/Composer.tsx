import { PaperPlaneRightIcon } from '@phosphor-icons/react';
import {
  type FocusEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { LIMITS } from '#shared/limits';
import type { Op } from '#shared/protocol';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** The box at the top of each column. Enter posts, Shift+Enter breaks a line. */
export function Composer({
  columnId,
  anonymousAllowed,
  dispatch,
}: {
  columnId: string;
  anonymousAllowed: boolean;
  dispatch: (op: Op) => void;
}) {
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [focused, setFocused] = useState(false);
  const id = useId();
  const trimmed = text.trim();
  const pressing = usePointerPressed();

  /**
   * Shrink once focus has gone. A press elsewhere takes focus on
   * pointerdown, and shrinking then would move whatever is under the pointer
   * before the click lands (a vote, the anonymous checkbox), so wait for the
   * press to end and its click to fire.
   */
  function blur(event: FocusEvent<HTMLTextAreaElement>) {
    const box = event.currentTarget;
    const collapse = () => {
      if (document.activeElement !== box) {
        setFocused(false);
      }
    };
    if (!pressing.current) {
      collapse();
      return;
    }
    const release = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.setTimeout(collapse, 0);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed) {
      return;
    }
    dispatch({
      type: 'addCard',
      id: crypto.randomUUID(),
      columnId,
      text: trimmed,
      anonymous: anonymous && anonymousAllowed,
    });
    setText('');
  }

  const expanded = focused || text.length > 0;

  return (
    <form onSubmit={submit} className="grid gap-2">
      <Textarea
        aria-label="New card"
        value={text}
        rows={expanded ? 3 : 1}
        maxLength={LIMITS.cardTextMax}
        placeholder="Add a card…"
        onFocus={() => setFocused(true)}
        onBlur={blur}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-0 resize-none transition-[height] duration-(--duration-base) ease-(--ease-emphasized)"
      />
      {expanded && (
        <div className="stagger-in flex items-center justify-between gap-2">
          {anonymousAllowed ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-anon`}
                checked={anonymous}
                onCheckedChange={(v) => setAnonymous(Boolean(v))}
              />
              <Label
                htmlFor={`${id}-anon`}
                className="text-xs font-normal text-muted-foreground"
              >
                Post anonymously
              </Label>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <span className="text-[0.65rem] text-muted-foreground tabular">
              {text.length}/{LIMITS.cardTextMax}
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={!trimmed}
              className="press"
            >
              <PaperPlaneRightIcon data-icon="inline-start" />
              Post
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** Whether a pointer is pressed anywhere on the page right now. */
function usePointerPressed() {
  const pressed = useRef(false);
  useEffect(() => {
    const down = () => {
      pressed.current = true;
    };
    const up = () => {
      pressed.current = false;
    };
    // Capture, so a press counts before its pointerdown blurs anything.
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);
  return pressed;
}
