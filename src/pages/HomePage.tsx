import { ArrowRightIcon, CrownSimpleIcon, XIcon } from '@phosphor-icons/react';
import { type FormEvent, useEffect, useState } from 'react';
import { CODE_LENGTH, isValidCode, normalizeCode } from '#shared/codes';
import { LIMITS } from '#shared/limits';
import { type AppConfig, TURNSTILE_ACTION } from '#shared/protocol';
import { DEFAULT_TEMPLATE_ID, TEMPLATES } from '#shared/templates';
import { Turnstile } from '@/components/Turnstile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRemaining, useNow } from '@/hooks/useNow';
import { ApiError, createBoard, getBoardMeta } from '@/lib/api';
import {
  setName as saveName,
  setOwnerToken,
  useIdentity,
} from '@/lib/identity';
import {
  forgetBoard,
  rememberBoard,
  useRecentBoards,
} from '@/lib/recent-boards';
import { linkProps, navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useToast } from '@/providers/ToastProvider';

export function HomePage() {
  const config = useConfig();
  return (
    <div className="flex w-full flex-1 flex-col gap-8 px-4 py-10 sm:px-6 lg:py-10">
      <section
        className="stagger-in"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <h1 className="max-w-3xl text-pretty font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          The retro board that doesn't archive your retros.
        </h1>
        <p className="mt-4 max-w-4xl text-pretty text-base text-muted-foreground sm:text-lg">
          No accounts, no history, no trace. Share a six-character key, unlock
          the holocron together, and export the wisdom worth keeping. Everything
          else is purged from the archives at dawn.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] xl:grid-cols-[2fr_1fr]">
        <CreatePanel turnstileSiteKey={config?.turnstileSiteKey ?? null} />
        <div className="flex flex-col gap-6">
          <JoinPanel />
          <RecentPanel />
        </div>
      </div>
    </div>
  );
}

function CreatePanel({
  turnstileSiteKey,
}: {
  turnstileSiteKey: string | null;
}) {
  const identity = useIdentity();
  const toast = useToast();
  const [humanToken, setHumanToken] = useState<string | null>(null);
  // Bumped to remount the widget: each token is good for one request.
  const [humanCheck, setHumanCheck] = useState(0);
  const needsHuman = turnstileSiteKey !== null && humanToken === null;
  const [name, setName] = useState(identity.name);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!name && identity.name) {
      setName(identity.name);
    }
  }, [identity.name, name]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy || needsHuman) {
      return;
    }
    setBusy(true);
    try {
      saveName(trimmed);
      const created = await createBoard({
        title: title.trim(),
        templateId,
        participantId: identity.id,
        secret: identity.secret,
        name: trimmed,
        turnstileToken: humanToken ?? undefined,
      });
      setOwnerToken(created.code, created.ownerToken);
      rememberBoard({
        code: created.code,
        title:
          title.trim() ||
          TEMPLATES.find((t) => t.id === templateId)?.name ||
          'Retro',
        expiresAt: created.expiresAt,
        owner: true,
      });
      navigate({ name: 'board', code: created.code });
    } catch (error) {
      toast.show(
        error instanceof ApiError
          ? error.message
          : 'Could not create the board',
      );
      setBusy(false);
      if (turnstileSiteKey) {
        setHumanToken(null);
        setHumanCheck((n) => n + 1);
      }
    }
  }

  return (
    <Card className="stagger-in" style={{ '--i': 1 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle className="text-lg">Create a board</CardTitle>
        <CardDescription>
          You will be its owner: only you can delete it early.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-5">
          <div className="grid gap-x-2 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="create-name">Your name</Label>
              <Input
                id="create-name"
                required
                maxLength={LIMITS.nameMax}
                autoComplete="nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Leia"
              />
            </div>
            <div className="grid gap-2 xl:col-span-2">
              <Label htmlFor="create-title">
                Board title{' '}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="create-title"
                maxLength={LIMITS.titleMax}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sprint 42 retro"
              />
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Template</legend>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {TEMPLATES.map((template, i) => {
                const selected = template.id === templateId;
                return (
                  <label
                    key={template.id}
                    className={cn(
                      'press stagger-in flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 has-focus-visible:outline-2 has-focus-visible:outline-ring/60',
                      selected && 'border-foreground/60 bg-muted/60',
                    )}
                    style={{ '--i': i + 2 } as React.CSSProperties}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={template.id}
                      checked={selected}
                      onChange={() => setTemplateId(template.id)}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{template.name}</span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-3 rounded-full border transition-colors',
                          selected
                            ? 'border-foreground bg-foreground'
                            : 'border-border',
                        )}
                      />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {template.description}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {template.columns.map(({ title }) => (
                        <Badge
                          key={title}
                          variant="outline"
                          className="font-normal"
                        >
                          {title}
                        </Badge>
                      ))}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {turnstileSiteKey && (
              <div className="mr-auto">
                <Turnstile
                  key={humanCheck}
                  siteKey={turnstileSiteKey}
                  action={TURNSTILE_ACTION}
                  onToken={setHumanToken}
                  onError={() =>
                    toast.show(
                      'The human check could not load. Reload and try again.',
                    )
                  }
                />
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              disabled={busy || !name.trim() || needsHuman}
              className="press"
            >
              {busy ? 'Creating…' : 'Create board'}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function JoinPanel() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeCode(code);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isValidCode(normalized)) {
      setError(`Codes are ${CODE_LENGTH} letters and numbers.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await getBoardMeta(normalized);
      navigate({ name: 'board', code: normalized });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'No board with that code. It may have expired.'
          : err instanceof ApiError && err.status === 429
            ? err.message
            : 'Could not reach the board. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <Card className="stagger-in" style={{ '--i': 2 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle className="text-lg">Join a board</CardTitle>
        <CardDescription>
          Enter the code someone shared with you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-2">
          <Label htmlFor="join-code">Board code</Label>
          <div className="flex items-start gap-2">
            <div className="grid flex-1 gap-1">
              <Input
                id="join-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                placeholder="ABC123"
                maxLength={CODE_LENGTH + 2}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'join-error' : undefined}
                className="code-display h-9 text-base"
              />
              {error && (
                <p id="join-error" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button
              type="submit"
              size="lg"
              variant="secondary"
              disabled={busy}
              className="press"
            >
              {busy ? 'Checking…' : 'Join'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RecentPanel() {
  const recent = useRecentBoards();
  const now = useNow(30_000);
  if (recent.length === 0) {
    return null;
  }
  return (
    <Card className="stagger-in" style={{ '--i': 3 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle className="text-lg">Your recent boards</CardTitle>
        <CardDescription>On this device, until they expire.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        {recent.map((board) => (
          <div
            key={board.code}
            className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
          >
            <a
              {...linkProps({ name: 'board', code: board.code })}
              className="flex min-w-0 flex-1 items-center gap-3 outline-ring/50 focus-visible:outline-2"
            >
              <span className="code-display text-xs text-muted-foreground">
                {board.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {board.title}
              </span>
              {board.owner && (
                <CrownSimpleIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="You own this board"
                />
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {formatRemaining(board.expiresAt - now)} left
              </span>
            </a>
            <Button
              variant="ghost"
              size="icon-xs"
              className="press opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              aria-label={`Forget ${board.title}`}
              onClick={() => forgetBoard(board.code)}
            >
              <XIcon />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Deployment facts (reset time) for the copy on this page. */
export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((r) => (r.ok ? (r.json() as Promise<AppConfig>) : null))
      .then((c) => {
        if (!cancelled && c) {
          setConfig(c);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
