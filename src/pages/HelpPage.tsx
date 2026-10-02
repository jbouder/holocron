import { LIMITS } from '#shared/limits';
import { TEMPLATES } from '#shared/templates';
import { DEFAULT_SETTINGS, REACTIONS } from '#shared/types';
import { Badge } from '@/components/ui/badge';
import { linkProps } from '@/lib/router';
import { useConfig } from '@/pages/HomePage';

/**
 * How to use Holocron. Running your own copy is documented in the repository,
 * not here.
 */
export function HelpPage() {
  const config = useConfig();
  const resetLabel = config?.resetLabel ?? '6:00 AM ET';

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <div className="stagger-in" style={{ '--i': 0 } as React.CSSProperties}>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          How Holocron works
        </h1>
        <p className="mt-2 text-muted-foreground">
          A retro board for one session. No accounts, no history: create, share
          the code, run the retro, export, done.
        </p>
      </div>

      <nav
        aria-label="On this page"
        className="stagger-in mt-6 flex flex-wrap gap-2"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {s.title}
          </a>
        ))}
      </nav>

      <div className="mt-10 grid gap-10">
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
            Templates set the starting columns. Anyone on the board can add,
            rename and remove columns afterwards (up to {LIMITS.columnsMax}),
            unless the owner has locked facilitation to themselves.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <li key={t.id} className="rounded-md border p-3">
                <div className="font-medium">{t.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.columns.map((c) => (
                    <Badge key={c} variant="outline" className="font-normal">
                      {c}
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
              Voting is closed.
            </Term>
            <Term name="Vote">
              Cards are revealed. Each person has a budget of votes (
              {DEFAULT_SETTINGS.votesPerPerson} by default; the owner can set
              anything from {LIMITS.votesPerPersonMin} to{' '}
              {LIMITS.votesPerPersonMax}) to spend on the cards that matter
              most. You can put several votes on one card and take them back.
            </Term>
            <Term name="Discuss">
              Columns sort by votes so the top items are at the top. Vote counts
              show. Capture decisions in the Action items panel.
            </Term>
          </dl>
          <p>
            By default anyone can move the phase, set the timer, rename the
            board and change its columns. The owner can lock all of that to
            themselves in Settings ("Only I can facilitate").
          </p>
        </Section>

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
        </Section>

        <Section id="timer" title="Timer" index={8}>
          <p>
            The timer in the toolbar runs for everyone. Pick a length from one
            to {LIMITS.timerMaxMs / 60_000} minutes; it counts down on every
            screen and pulses when it reaches zero. There is no sound.
          </p>
        </Section>

        <Section id="actions" title="Action items" index={9}>
          <p>
            Open the Action items panel from the toolbar (it opens itself when
            you enter Discuss). Add an item, name an owner, and tick it off when
            it is done. Action items are part of the export.
          </p>
        </Section>

        <Section id="export" title="Export" index={10}>
          <p>
            Export gives you the board as Markdown: every column, grouped cards
            with their vote and reaction counts, comments under their card, and
            the action items. Download it or copy it to the clipboard and paste
            it into your wiki or chat. Do this before the board expires; there
            is no later.
          </p>
        </Section>

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

        <Section id="data" title="Data and retention" index={12}>
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
            Your name, your random identity, your theme and motion preferences,
            and the list of recent boards are stored in this browser's local
            storage. Clearing site data removes them.
          </p>
        </Section>

        <Section id="shortcuts" title="Keyboard" index={13}>
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

        <Section id="preferences" title="Preferences" index={14}>
          <p>
            The gear icon holds a motion switch, the theme, and your name.
            Themes: System (follows your device), Light, Dark (side), and three
            just for fun: Dagobah, Tatooine and Synthwave. The theme is yours
            alone; other people on the board keep their own. Motion follows your
            operating system's "reduce motion" setting first; when that is on,
            the switch is disabled and nothing animates.
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
    </div>
  );
}

const SECTIONS = [
  { id: 'boards', title: 'Boards and codes' },
  { id: 'name', title: 'Your name' },
  { id: 'phases', title: 'Phases' },
  { id: 'cards', title: 'Cards' },
  { id: 'reactions', title: 'Reactions and comments' },
  { id: 'grouping', title: 'Grouping' },
  { id: 'timer', title: 'Timer' },
  { id: 'actions', title: 'Action items' },
  { id: 'export', title: 'Export' },
  { id: 'ownership', title: 'Ownership' },
  { id: 'data', title: 'Data and retention' },
  { id: 'shortcuts', title: 'Keyboard' },
  { id: 'preferences', title: 'Preferences' },
];

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
  return (
    <section
      id={id}
      className="stagger-in scroll-mt-20 grid gap-3 text-sm leading-relaxed text-muted-foreground [&_p]:text-pretty"
      style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
    >
      <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
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
