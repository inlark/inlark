/** Fictional accounts and mail shown in the page's product illustrations. */

export type AccountId = 'personal' | 'studio' | 'projects' | 'community'

export interface Account {
  id: AccountId
  name: string
  email: string
  /** Two stops of the marble mark the app generates for accounts without a picture. */
  mark: [string, string]
}

export const accounts: Account[] = [
  { id: 'personal', name: 'Personal', email: 'sam@hey-sam.net', mark: ['#a69aef', '#4b3fb5'] },
  { id: 'studio', name: 'Studio', email: 'sam@fernstudio.design', mark: ['#7caee4', '#4b3fb5'] },
  { id: 'projects', name: 'Projects', email: 'dev@samlark.io', mark: ['#e7ae7c', '#d491ac'] },
  { id: 'community', name: 'Community', email: 'sam@nixmeetup.org', mark: ['#d491ac', '#4b3fb5'] },
]

export const accountById = Object.fromEntries(accounts.map((a) => [a.id, a])) as Record<
  AccountId,
  Account
>

export interface Conversation {
  id: string
  sender: string
  /** Tile colour for the sender's initials. */
  tint: string
  subject: string
  preview: string
  time: string
  account: AccountId
  unread?: boolean
  starred?: boolean
  attachment?: boolean
  count?: number
  body?: string[]
}

export const inbox: Conversation[] = [
  {
    id: 'maya',
    sender: 'Maya Chen',
    tint: '#a69aef',
    subject: 'A few thoughts on the new direction',
    preview: 'I took another look at the explorations. The quieter direction feels right to me.',
    time: '9:41 AM',
    account: 'studio',
    unread: true,
    starred: true,
    count: 3,
    body: [
      'Hi Sam,',
      'I took another look at the explorations this morning. The quieter direction feels right — it gets out of the way and lets the work breathe.',
      'Could we try the second variation with a little more space around the headings? I think that’s all it needs.',
      'Talk soon,\nMaya',
    ],
  },
  {
    id: 'jonas',
    sender: 'Jonas Weber',
    tint: '#83bba8',
    subject: 'Final files are in the shared folder',
    preview: 'Everything should be ready for tomorrow’s review. Let me know if anything’s missing.',
    time: '9:12 AM',
    account: 'studio',
    unread: true,
    attachment: true,
    body: [
      'Morning Sam,',
      'Final files are in the shared folder — the print PDFs, the source files, and the exported icons at every size.',
      'Everything should be ready for tomorrow’s review. Let me know if anything’s missing.',
      'Jonas',
    ],
  },
  {
    id: 'priya',
    sender: 'Priya Nair',
    tint: '#e7ae7c',
    subject: 'Photos from the weekend',
    preview: 'A few favourites from the hike. The sunrise from the ridge was unreal.',
    time: '8:47 AM',
    account: 'personal',
    unread: true,
    attachment: true,
    body: [
      'Sam!',
      'A few favourites from the hike are attached. The sunrise from the ridge was unreal — worth every minute of that 4:30 alarm.',
      'Same time next month?',
      'P.',
    ],
  },
  {
    id: 'ci',
    sender: 'Forgejo',
    tint: '#7caee4',
    subject: 'All checks passed on main',
    preview: 'imap: reconcile flags after IDLE reconnect · 214 tests, 0 failures, 1m 12s.',
    time: '8:30 AM',
    account: 'projects',
    body: [
      'All checks passed on main.',
      'imap: reconcile flags after IDLE reconnect\n214 tests · 0 failures · 1m 12s',
      'You are receiving this because you watch this repository.',
    ],
  },
  {
    id: 'alex',
    sender: 'Alex Rivera',
    tint: '#d491ac',
    subject: 'Re: Coffee sometime next week?',
    preview:
      'Thursday works for me! There’s a new place around the corner I’ve been meaning to try.',
    time: '8:05 AM',
    account: 'personal',
    count: 4,
    body: [
      'Thursday works for me!',
      'There’s a new place around the corner I’ve been meaning to try. 10:00?',
      'Alex',
    ],
  },
  {
    id: 'meetup',
    sender: 'Lena Hoffmann',
    tint: '#aaa6ec',
    subject: 'October meetup: call for talks',
    preview:
      'We have two lightning slots left. Anything on reproducible desktops would be perfect.',
    time: '7:52 AM',
    account: 'community',
    starred: true,
    body: [
      'Hi all,',
      'We have two lightning-talk slots left for the October meetup. Anything on reproducible desktops would be perfect.',
      'Reply to this thread if you’d like one.',
      'Lena',
    ],
  },
  {
    id: 'invoice',
    sender: 'Northwind Hosting',
    tint: '#96969e',
    subject: 'Your invoice for September is ready',
    preview: 'Your monthly invoice is now available. Thank you for building with us.',
    time: '7:30 AM',
    account: 'projects',
    attachment: true,
    body: [
      'Your invoice for September is ready.',
      'Amount due: €11.90. It will be charged to your card on file on October 1.',
      'Thank you for building with us.',
    ],
  },
  {
    id: 'daniel',
    sender: 'Daniel Fischer',
    tint: '#76bc9a',
    subject: 'The book I mentioned',
    preview: 'Found it — it’s the one about bird migration. You’ll love the chapter on skylarks.',
    time: 'Yesterday',
    account: 'personal',
    body: [
      'Found it!',
      'It’s the one about bird migration. You’ll love the chapter on skylarks — they sing while they climb.',
      'D.',
    ],
  },
  {
    id: 'ines',
    sender: 'Ines Duarte',
    tint: '#83bba8',
    subject: 'Re: Saturday at the market?',
    preview: 'Perfect, see you by the bakery stand at nine. I’ll bring the good coffee.',
    time: 'Yesterday',
    account: 'personal',
    count: 2,
  },
  {
    id: 'tomas',
    sender: 'Tomás Silva',
    tint: '#e7ae7c',
    subject: 'Signed contract attached',
    preview: 'All signed on our side. Looking forward to kicking things off next month.',
    time: 'Yesterday',
    account: 'studio',
    attachment: true,
  },
]

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
