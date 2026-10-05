import type { ComponentType } from 'react'
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react'
import {
  AlertCircle as AlertCircleGlyph,
  AppleIcon as AppleGlyph,
  Archive as ArchiveGlyph,
  ArrowDown as ArrowDownGlyph,
  ArrowLeft as ArrowLeftGlyph,
  ArrowUp as ArrowUpGlyph,
  ArrowUpRight as ArrowUpRightGlyph,
  Bold as BoldGlyph,
  Calendar as CalendarGlyph,
  CalendarAdd02Icon as CalendarAddGlyph,
  Check as CheckGlyph,
  ChevronDown as ChevronDownGlyph,
  ChevronLeft as ChevronLeftGlyph,
  ChevronRight as ChevronRightGlyph,
  ChevronUp as ChevronUpGlyph,
  Copy as CopyGlyph,
  CornerDownLeft as CornerDownLeftGlyph,
  Download as DownloadGlyph,
  ExternalLink as ExternalLinkGlyph,
  File as FileGlyph,
  FileArchive as FileArchiveGlyph,
  FileImage as FileImageGlyph,
  FileSpreadsheetIcon as FileSpreadsheetIconGlyph,
  FileText as FileTextGlyph,
  Folder as FolderGlyph,
  FolderInputIcon as FolderInputIconGlyph,
  FolderPlus as FolderPlusGlyph,
  Forward as ForwardGlyph,
  ImageRemove01Icon as ImageRemoveGlyph,
  ImageUpload01Icon as ImageUploadGlyph,
  ImageOff as ImageOffGlyph,
  Inbox as InboxGlyph,
  Info as InfoGlyph,
  Italic as ItalicGlyph,
  Keyboard as KeyboardGlyph,
  LaptopIcon as LaptopGlyph,
  Link2 as Link2Glyph,
  List as ListGlyph,
  LoaderCircle as LoaderCircleGlyph,
  LockKeyhole as LockKeyholeGlyph,
  Mail as MailGlyph,
  MailMinus01Icon as MailMinusGlyph,
  MailOpen as MailOpenGlyph,
  Minus as MinusGlyph,
  Monitor as MonitorGlyph,
  Moon as MoonGlyph,
  MoreHorizontal as MoreHorizontalGlyph,
  PanelLeftClose as PanelLeftCloseGlyph,
  PanelLeftOpen as PanelLeftOpenGlyph,
  ParagraphBulletsPoint02Icon as BulletListGlyph,
  Paperclip as PaperclipGlyph,
  PenLine as PenLineGlyph,
  PencilEdit02Icon as PencilEditGlyph,
  Plus as PlusGlyph,
  RefreshCw as RefreshCwGlyph,
  Reply as ReplyGlyph,
  ReplyAll as ReplyAllGlyph,
  Rows3 as Rows3Glyph,
  Search as SearchGlyph,
  Send as SendGlyph,
  Settings as SettingsGlyph,
  Share08Icon as ShareGlyph,
  SettingsIcon as SettingsIconGlyph,
  ShieldCheck as ShieldCheckGlyph,
  ShieldX as ShieldXGlyph,
  Shuffle as ShuffleGlyph,
  SlidersHorizontal as SlidersHorizontalGlyph,
  SquarePenIcon as SquarePenGlyph,
  Star as StarGlyph,
  Sun as SunGlyph,
  TerminalIcon as TerminalGlyph,
  Trash2 as Trash2Glyph,
  Undo2 as Undo2Glyph,
  UserRound as UserRoundGlyph,
  WifiOff as WifiOffGlyph,
  WindowsNewIcon as WindowsGlyph,
  X as XGlyph,
} from '@hugeicons/core-free-icons'

export type IconComponent = ComponentType<Omit<HugeiconsIconProps, 'icon'>>

const icon =
  (glyph: IconSvgElement): IconComponent =>
  (props) => <HugeiconsIcon icon={glyph} color="currentColor" {...props} />

export const AlertCircle = icon(AlertCircleGlyph)
export const Apple = icon(AppleGlyph)
export const Archive = icon(ArchiveGlyph)
export const ArrowDown = icon(ArrowDownGlyph)
export const ArrowLeft = icon(ArrowLeftGlyph)
export const ArrowUp = icon(ArrowUpGlyph)
export const ArrowUpRight = icon(ArrowUpRightGlyph)
export const Bold = icon(BoldGlyph)
export const Calendar = icon(CalendarGlyph)
export const CalendarAdd = icon(CalendarAddGlyph)
export const Check = icon(CheckGlyph)
export const ChevronDown = icon(ChevronDownGlyph)
export const ChevronLeft = icon(ChevronLeftGlyph)
export const ChevronRight = icon(ChevronRightGlyph)
export const ChevronUp = icon(ChevronUpGlyph)
export const Copy = icon(CopyGlyph)
export const CornerDownLeft = icon(CornerDownLeftGlyph)
export const Download = icon(DownloadGlyph)
export const ExternalLink = icon(ExternalLinkGlyph)
export const File = icon(FileGlyph)
export const FileArchive = icon(FileArchiveGlyph)
export const FileImage = icon(FileImageGlyph)
export const FileSpreadsheet = icon(FileSpreadsheetIconGlyph)
export const FileText = icon(FileTextGlyph)
export const Folder = icon(FolderGlyph)
export const FolderInput = icon(FolderInputIconGlyph)
export const FolderPlus = icon(FolderPlusGlyph)
export const Forward = icon(ForwardGlyph)
export const ImageRemove = icon(ImageRemoveGlyph)
export const ImageUpload = icon(ImageUploadGlyph)
export const ImageOff = icon(ImageOffGlyph)
export const Inbox = icon(InboxGlyph)
export const Info = icon(InfoGlyph)
export const Italic = icon(ItalicGlyph)
export const Keyboard = icon(KeyboardGlyph)
export const Laptop = icon(LaptopGlyph)
export const Link2 = icon(Link2Glyph)
export const List = icon(ListGlyph)
export const LoaderCircle = icon(LoaderCircleGlyph)
export const LockKeyhole = icon(LockKeyholeGlyph)
export const Mail = icon(MailGlyph)
export const MailMinus = icon(MailMinusGlyph)
export const MailOpen = icon(MailOpenGlyph)
export const Minus = icon(MinusGlyph)
export const Monitor = icon(MonitorGlyph)
export const Moon = icon(MoonGlyph)
export const MoreHorizontal = icon(MoreHorizontalGlyph)
export const PanelLeftClose = icon(PanelLeftCloseGlyph)
export const PanelLeftOpen = icon(PanelLeftOpenGlyph)
export const BulletList = icon(BulletListGlyph)
export const Paperclip = icon(PaperclipGlyph)
export const PenLine = icon(PenLineGlyph)
export const PencilEdit = icon(PencilEditGlyph)
export const Plus = icon(PlusGlyph)
export const RefreshCw = icon(RefreshCwGlyph)
export const Reply = icon(ReplyGlyph)
export const ReplyAll = icon(ReplyAllGlyph)
export const Rows3 = icon(Rows3Glyph)
export const Search = icon(SearchGlyph)
export const Send = icon(SendGlyph)
export const Settings = icon(SettingsGlyph)
export const Share = icon(ShareGlyph)
export const SettingsIcon = icon(SettingsIconGlyph)
export const ShieldCheck = icon(ShieldCheckGlyph)
export const ShieldX = icon(ShieldXGlyph)
export const Shuffle = icon(ShuffleGlyph)
export const SlidersHorizontal = icon(SlidersHorizontalGlyph)
export const SquarePen = icon(SquarePenGlyph)
export const Star = icon(StarGlyph)
export const Sun = icon(SunGlyph)
export const Terminal = icon(TerminalGlyph)
export const Trash2 = icon(Trash2Glyph)
export const Undo2 = icon(Undo2Glyph)
export const UserRound = icon(UserRoundGlyph)
export const WifiOff = icon(WifiOffGlyph)
export const Windows = icon(WindowsGlyph)
export const X = icon(XGlyph)
