import { ArrowUpIcon, LinkSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import { TEMPLATES } from '#shared/templates';
import { DEFAULT_SETTINGS, REACTIONS } from '#shared/types';
import { Badge } from '@/components/ui/badge';
import { ANALYSIS_MODELS, MODEL_SOURCE } from '@/lib/analysis';
import { linkProps, navigate, useRoute } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useConfig } from '@/pages/HomePage';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

/**
 * How to use Holocron. Running your own copy is documented in the repository,
 * not here.
 */
export function HelpPage() {
  const config = useConfig();
  const resetLabel = config?.resetLabel ?? '6:00 AM ET';

  const route = useRoute();
  const { active: motion } = useMotion();
  // Read at jump time; flipping the switch is not a reason to jump again.
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const current = useCurrentSection();
  const scrolled = useScrolledPast(600);

  // Jump to the section in the URL: on load, from a `?` link on the board,
  // from the table of contents, and on Back/Forward. Focus follows the jump
  // so keyboard and screen-reader users land where they were sent.
  const section = route.name === 'help' ? route.section : undefined;
  // The route the page mounted with; every navigation after it is a new object.
  const initialRoute = useRef(route);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `route` is a new object on every navigation, even to the same section, and each one should jump.
  useEffect(() => {
    const first = route === initialRoute.current;
    if (!section && first) {
      return;
    }
    const jump = () => {
      const target = document.getElementById(
        section ? `${section}-title` : 'help-title',
      );
      if (!target) {
        return;
      }
      // A direct load has nothing to animate from.
      const behavior: ScrollBehavior =
        motionRef.current && !first ? 'smooth' : 'instant';
      if (section) {
        target.closest('section')?.scrollIntoView({ behavior, block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior });
      }
      target.focus({ preventScroll: true });
    };
    if (!first) {
      jump();
      return;
    }
    // On a direct load, web fonts arriving after the jump would reflow the
    // page above the target and push it under the header. Wait for them.
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) {
        requestAnimationFrame(jump);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [route]);

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:grid lg:grid-cols-[13rem_minmax(0,48rem)] lg:content-start lg:gap-x-12">
      <aside className="hidden lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:block">
        <TableOfContents current={current} />
      </aside>

      <div
        className="stagger-in lg:col-start-2"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <h1
          id="help-title"
          tabIndex={-1}
          className="font-heading text-3xl font-semibold tracking-tight outline-none"
        >
          How Holocron works
        </h1>
        <p className="mt-2 text-muted-foreground">
          The retro board that doesn't keep your retros. No accounts, no
          history: create, share the code, run the retro, export, done. The
          board is erased from the archives every morning.
        </p>
      </div>

      <JumpTo current={current} />

      <div className="mt-10 grid gap-10 lg:col-start-2">
        <GroupHeading id="getting-started" first />

        <Section id="boards" title="Boards and codes" index={2}>
          <p>
            Anyone can create a board from the{' '}
            <a
              {...linkProps({ name: 'home' })}
              className="underline underline-offset-4"
            >
              home page
            </a>
            . Pick a template, give it a title if you like, and you get a
            six-character code such as{' '}
            <span className="code-display">K7MXQ2</span>. Share the code or the
            link, or let people in the room scan the QR code in the Share
            dialog; whoever opens it is on the board. There are no invitations
            and no passwords. Some sites ask for a quick human check (Cloudflare
            Turnstile) before the Create button works; joining never does.
          </p>
          <p>
            Templates set the starting columns, each with a one-line prompt
            under its title. The owner can add, rename and remove columns and
            edit their prompts afterwards (up to {LIMITS.columnsMax} columns),
            from the column's <Kbd>⋯</Kbd> menu, and so can everyone else once
            the owner opens facilitation up.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <li key={t.id} className="rounded-md border p-3">
                <div className="font-medium">{t.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.columns.map(({ title }) => (
                    <Badge
                      key={title}
                      variant="outline"
                      className="font-normal"
                    >
                      {title}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="name" title="Your name" index={3}>
          <p>
            The first time you open a board you are asked for a name. It is
            stored in this browser only and shown on your cards and in the row
            of avatars at the top. Change it any time from Preferences (the gear
            icon); your existing cards update too.
          </p>
          <p>
            Each browser gets a random identity, so a card you wrote on your
            laptop is not "yours" on your phone.
          </p>
        </Section>

        <Section id="phases" title="Phases" index={4}>
          <p>
            A retro runs through three phases. The stepper at the top of the
            board moves everyone at once.
          </p>
          <dl className="grid gap-3">
            <Term name="Write">
              Everyone adds cards. Other people's cards are blurred so nobody
              anchors on the first thing posted (the owner can turn this off).
              Voting is closed. When you have nothing more to add, press{' '}
              <strong>I'm done</strong>: a check appears on your avatar and the
              count next to the avatars ("3 of 5 done") tells the facilitator
              when to move on. Press it again to take it back. It resets when
              the phase changes.
            </Term>
            <Term name="Vote">
              Cards are revealed. Each person has a budget of votes (
              {DEFAULT_SETTINGS.votesPerPerson} by default; the owner can set
              anything from {LIMITS.votesPerPersonMin} to{' '}
              {LIMITS.votesPerPersonMax}) to spend on the cards that matter
              most. You can put several votes on one card and take them back.
              Each avatar shows how many votes that person has left, and the
              count next to the avatars shows who has spent them all. Where
              anyone's votes went is never shown there.
            </Term>
            <Term name="Discuss">
              Columns sort by votes so the top items are at the top. Vote counts
              show. Capture decisions in the Action items panel.
            </Term>
          </dl>
          <p>
            By default only the owner can move the phase, set the timer, rename
            the board and change its columns. To share that with everyone, the
            owner turns off "Only I can facilitate" in Settings.
          </p>
        </Section>

        <GroupHeading id="running" />

        <Section id="cards" title="Cards" index={5}>
          <p>
            Type in a column's box and press <Kbd>Enter</Kbd> to post (
            <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line). Tick "Post
            anonymously" to leave your name off a card; the owner can disable
            anonymous cards for the board.
          </p>
          <p>
            An anonymous card is anonymous to everyone, the owner included: the
            server sends it out without any author information, so nobody on the
            board can work out who posted it. Only the browser you posted it
            from knows it is yours, which is how you can still edit or delete
            it. Votes and reactions are not anonymous.
          </p>
          <p>
            To change a card you wrote, use the <Kbd>⋯</Kbd> button at its top
            right. It is faint until you hover the card (on touch screens it is
            always shown). Choose Edit, change the text, then press{' '}
            <Kbd>Enter</Kbd> to save, <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a
            new line, or <Kbd>Esc</Kbd> to cancel. Double-clicking (or
            double-tapping) the card's text opens the same editor. Delete is in
            the same menu. Cards are up to {LIMITS.cardTextMax} characters.
          </p>
          <p>
            Edit only appears on cards you wrote in this browser. Your identity
            is per browser (see{' '}
            <a href="#name" className="underline underline-offset-4">
              Your name
            </a>
            ), so cards you posted from another device show no Edit here. The
            owner can delete any card.
          </p>
        </Section>

        <Section id="reactions" title="Reactions and comments" index={6}>
          <p>
            React to a card with the smiley button at its bottom right:{' '}
            {REACTIONS.map((r) => r.emoji).join(' ')}. Each is a quick "+1" that
            costs no votes and does not change how cards are sorted. Pick the
            same one again, or tap its chip under the card, to take it back.
            Hover a chip to see who reacted.
          </p>
          <p>
            The speech bubble opens a card's comments, for context that comes up
            while you discuss it ("this was the Tuesday deploy"). Comments are
            up to {LIMITS.commentTextMax} characters,{' '}
            {LIMITS.commentsPerCardMax} per card, and can be anonymous when the
            board allows anonymous cards. You can edit and delete your own; the
            owner can delete any.
          </p>
          <p>
            While other people's cards are blurred in Write, you can't react to
            or comment on them. Both open up when Write ends.
          </p>
        </Section>

        <Section id="grouping" title="Grouping and moving" index={7}>
          <p>
            Drag a card by its handle and drop it on another card to group them.
            Groups show as a stack with a combined vote count. Drop a card on an
            empty part of a column to move it there, and use "Ungroup" on a
            stacked card to pull it back out. Dragging a card that is in a group
            moves the whole group.
          </p>
          <p>
            You can always move and group your own cards. Arranging other
            people's cards is for the owner, unless they have turned off "Only I
            can facilitate".
          </p>
        </Section>

        <Section id="timer" title="Timer" index={8}>
          <p>
            The timer in the toolbar runs for everyone. Pick a length from one
            to {LIMITS.timerMaxMs / 60_000} minutes; it counts down on every
            screen and pulses when it reaches zero. At zero each device also
            plays a short chime and puts "⏰ Time's up" in the tab title, so you
            notice from another tab. The title goes back when you return to the
            tab. Turn the chime off with Timer sound in Preferences. Your
            browser only plays it once you have clicked or typed on the page.
          </p>
        </Section>

        <Section id="actions" title="Action items" index={9}>
          <p>
            Open the Action items panel from the toolbar (it opens itself when
            you enter Discuss). Add an item, name an owner, and tick it off when
            it is done. Action items are part of the export.
          </p>
          <p>
            To record where an action came from, choose Add action item in a
            card's <Kbd>⋯</Kbd> menu. The panel opens with the new item linked
            to that card. A linked item shows the card's text underneath; click
            it to jump to the card. Deleting the card keeps the action item and
            drops the link.
          </p>
        </Section>

        <Section id="export" title="Export" index={10}>
          <p>
            Export gives you the board in three formats. Download any of them or
            copy it to the clipboard. Do this before the board expires; there is
            no later.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-foreground">Markdown</span>:
              every column, grouped cards with their vote and reaction counts,
              comments under their card, and the action items with the card each
              came from. For a wiki.
            </li>
            <li>
              <span className="font-medium text-foreground">CSV</span>: the
              action items only, one per row (summary, owner, done, card), for
              importing into Jira, Linear or a spreadsheet.
            </li>
            <li>
              <span className="font-medium text-foreground">Summary</span>: the
              five most-voted cards and the action items as plain text, short
              enough to paste into Slack or Teams.
            </li>
          </ul>
          <p>Anonymous cards and comments never carry a name in any format.</p>
        </Section>

        <GroupHeading id="owner" />

        <Section id="ownership" title="Ownership and deleting" index={11}>
          <p>
            Whoever creates a board owns it. The owner can change settings (vote
            budget, anonymous cards, blurring, the facilitation lock), delete
            any card or comment, and delete the whole board. Ownership lives in
            the browser that created the board, so open it from the same device.
          </p>
          <p>
            Deleting a board removes it immediately for everyone on it. It
            cannot be undone.
          </p>
        </Section>

        <Section id="analysis" title="Analysis" index={12}>
          <p>
            In Discuss, the owner's toolbar has an Analysis button. It opens a
            panel where a small language model reads the board and offers three
            things: a summary of the themes, each citing the cards it comes
            from; groupings of cards that say the same thing; and draft action
            items. Nobody else on the board sees the button or the panel.
          </p>
          <p>
            The model runs in your browser, on your graphics card, so no card
            text goes to a server or an AI service. The first time, it asks
            before downloading anything. Pick a model to suit your machine:{' '}
            {ANALYSIS_MODELS.map((m, i) => (
              <span key={m.id}>
                {i > 0 && (i === ANALYSIS_MODELS.length - 1 ? ' or ' : ', ')}
                {m.name} ({m.downloadLabel}
                {i === 0 ? ', the default' : ''})
              </span>
            ))}
            . Bigger is sharper but needs more graphics memory. The download
            comes from {MODEL_SOURCE} and stays cached in this browser for next
            time; your pick is remembered here too. It needs WebGPU, which
            recent Chrome, Edge, Safari and Firefox have on most hardware; the
            panel says so if yours does not.
          </p>
          <p>
            Everything in the panel is a suggestion and can be wrong. Nothing
            touches the board until you accept one: accepting a grouping stacks
            the cards as a drag would, and accepting an action item adds it to
            the list linked to its card, where everyone sees it live. The
            suggestions themselves are never saved or exported, and nothing new
            is left for the daily wipe.
          </p>
        </Section>

        <GroupHeading id="data-and-settings" />

        <Section id="data" title="Data and retention" index={13}>
          <p>
            <strong className="text-foreground">
              Every board is wiped daily at {resetLabel}.
            </strong>{' '}
            Cards, votes, reactions, comments, names, action items, the lot. A
            board created at 11 PM lives until the next morning; one created at
            5:50 AM lives ten minutes (the create button warns you). The board
            header shows exactly when yours goes.
          </p>
          <p>
            While a board is live, its data is stored on the server that runs
            this site and is reachable by anyone who has the code. Do not put
            secrets on a retro board. Nothing is logged about who you are beyond
            the name you type, and nothing is kept after the wipe.
          </p>
          <p>
            Your name, your random identity, your theme, motion and timer-sound
            preferences, and the list of recent boards are stored in this
            browser's local storage. Clearing site data removes them.
          </p>
        </Section>

        <Section id="shortcuts" title="Keyboard" index={14}>
          <ul className="grid gap-1.5">
            <li>
              <Kbd>Enter</Kbd> post the card you are typing
            </li>
            <li>
              <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line in a card
            </li>
            <li>
              <Kbd>Enter</Kbd> save a card you are editing
            </li>
            <li>
              <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line while editing
            </li>
            <li>
              <Kbd>Esc</Kbd> cancel an edit
            </li>
            <li>
              <Kbd>Enter</Kbd> post a comment, <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>{' '}
              for a new line
            </li>
            <li>
              <Kbd>?</Kbd> open this page from a board
            </li>
          </ul>
        </Section>

        <Section id="preferences" title="Preferences" index={15}>
          <p>
            The gear icon holds a motion switch, the timer sound, the theme, and
            your name. Themes: System (follows your device), Light, Dark (side),
            and three just for fun: Dagobah, Tatooine and Synthwave. The theme
            is yours alone; other people on the board keep their own. Motion
            follows your operating system's "reduce motion" setting first; when
            that is on, the switch is disabled and nothing animates (the tab
            title shows the timer alert without flashing).
          </p>
          <p className="text-muted-foreground">
            Want to run Holocron on your own Cloudflare account? The{' '}
            <a
              href="https://github.com/jbouder/holocron"
              className="underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              repository
            </a>{' '}
            has the guide.
          </p>
        </Section>
      </div>

      <BackToTop visible={scrolled} />
    </div>
  );
}

/**
 * The table of contents, grouped by what you are trying to do. Section ids
 * are the URL fragments (`/help#timer`) the board's `?` links point at, so
 * keep them stable. The page renders the sections in this order.
 */
const GROUPS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    sections: [
      { id: 'boards', title: 'Boards and codes' },
      { id: 'name', title: 'Your name' },
      { id: 'phases', title: 'Phases' },
    ],
  },
  {
    id: 'running',
    title: 'Running a retro',
    sections: [
      { id: 'cards', title: 'Cards' },
      { id: 'reactions', title: 'Reactions and comments' },
      { id: 'grouping', title: 'Grouping' },
      { id: 'timer', title: 'Timer' },
      { id: 'actions', title: 'Action items' },
      { id: 'export', title: 'Export' },
    ],
  },
  {
    id: 'owner',
    title: 'For the board owner',
    sections: [
      { id: 'ownership', title: 'Ownership' },
      { id: 'analysis', title: 'Analysis' },
    ],
  },
  {
    id: 'data-and-settings',
    title: 'Your data and settings',
    sections: [
      { id: 'data', title: 'Data and retention' },
      { id: 'shortcuts', title: 'Keyboard' },
      { id: 'preferences', title: 'Preferences' },
    ],
  },
];

const SECTION_IDS = GROUPS.flatMap((g) => g.sections.map((s) => s.id));

/** The section nearest the top of the viewport, for the TOC highlight. */
function useCurrentSection(): string {
  const [current, setCurrent] = useState(SECTION_IDS[0]);
  useEffect(() => {
    const visible = new Set<string>();
    const pick = () => {
      // The last sections are short and can never reach the band at the top,
      // so at the very bottom the last one wins.
      const atEnd =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      const next = atEnd
        ? SECTION_IDS[SECTION_IDS.length - 1]
        : SECTION_IDS.find((id) => visible.has(id));
      if (next) {
        setCurrent(next);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }
        pick();
      },
      // A band just under the sticky header; the first section in it is
      // the current one.
      { rootMargin: '-96px 0px -60% 0px' },
    );
    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el);
      }
    }
    window.addEventListener('scroll', pick, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', pick);
    };
  }, []);
  return current;
}

function useScrolledPast(px: number): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > px);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [px]);
  return past;
}

/** Wide screens: a sticky sidebar that follows the reader down the page. */
function TableOfContents({ current }: { current: string }) {
  return (
    <nav
      aria-label="On this page"
      className="stagger-in sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pb-4 text-sm"
      style={{ '--i': 1 } as React.CSSProperties}
    >
      <p className="mb-4 text-xs font-medium text-foreground">On this page</p>
      <div className="grid gap-5">
        {GROUPS.map((group) => (
          <div key={group.id}>
            <p className="mb-1.5 text-xs text-muted-foreground">
              {group.title}
            </p>
            <ul className="grid border-l">
              {group.sections.map((s) => (
                <li key={s.id}>
                  <a
                    {...linkProps({ name: 'help', section: s.id })}
                    aria-current={current === s.id ? 'location' : undefined}
                    className={cn(
                      '-ml-px block border-l border-transparent py-1 pl-3 text-muted-foreground outline-ring/50 transition-colors hover:text-foreground focus-visible:outline-2',
                      current === s.id &&
                        'border-foreground font-medium text-foreground',
                    )}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** Narrow screens: a sticky picker in place of the sidebar. */
function JumpTo({ current }: { current: string }) {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-14 z-20 -mx-4 mt-6 border-b bg-background/85 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-background/70 sm:-mx-6 sm:px-6 lg:hidden"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">Jump to</span>
        <select
          value={current}
          onChange={(event) =>
            navigate({ name: 'help', section: event.target.value })
          }
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm text-foreground outline-ring/50 focus-visible:outline-2"
        >
          {GROUPS.map((group) => (
            <optgroup key={group.id} label={group.title}>
              {group.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </nav>
  );
}

function GroupHeading({ id, first }: { id: string; first?: boolean }) {
  const group = GROUPS.find((g) => g.id === id);
  return (
    <h2
      id={`group-${id}`}
      className={cn(
        '-mb-4 border-b pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase',
        !first && 'mt-6',
      )}
    >
      {group?.title}
    </h2>
  );
}

function BackToTop({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <a
      {...linkProps({ name: 'help' })}
      className="back-to-top press fixed right-4 bottom-4 z-20 inline-flex items-center gap-1.5 rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm outline-ring/50 backdrop-blur hover:text-foreground focus-visible:outline-2 sm:right-6 sm:bottom-6"
    >
      <ArrowUpIcon weight="bold" aria-hidden="true" />
      Back to top
    </a>
  );
}

function Section({
  id,
  title,
  index,
  children,
}: {
  id: string;
  title: string;
  index: number;
  children: React.ReactNode;
}) {
  const toast = useToast();
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/help#${id}`,
      );
      toast.show(`Link to “${title}” copied`);
    } catch {
      toast.show('Could not copy the link');
    }
  }
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="stagger-in grid scroll-mt-32 gap-3 text-sm leading-relaxed text-muted-foreground lg:scroll-mt-20 [&_p]:text-pretty"
      style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
    >
      <div className="group/heading flex items-center gap-1">
        <h3
          id={`${id}-title`}
          tabIndex={-1}
          className="font-heading text-xl font-semibold tracking-tight text-foreground outline-ring/50 focus-visible:outline-2"
        >
          {title}
        </h3>
        <button
          type="button"
          onClick={copyLink}
          aria-label={`Copy link to ${title}`}
          title="Copy link"
          className="press inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-ring/50 transition-opacity group-hover/heading:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 hover-none:opacity-100"
        >
          <LinkSimpleIcon weight="bold" aria-hidden="true" />
        </button>
      </div>
      {children}
    </section>
  );
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 rounded-md border p-3 sm:grid-cols-[6rem_1fr] sm:gap-3">
      <dt className="font-medium text-foreground">{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground">
      {children}
    </kbd>
  );
}
