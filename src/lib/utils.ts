/**
 * Formats bytes into human readable format (MB, GB, TB)
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Returns human readable relative time (e.g. "2 hours ago", "just now")
 */
export function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 5) return 'Just now';
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const minutes = Math.floor(diffInSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Calculates days remaining until token expires
 */
export function getTokenExpiryInfo(expiresAtString: string): {
  daysRemaining: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
  formatted: string;
} {
  const expiresAt = new Date(expiresAtString);
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const isExpired = daysRemaining <= 0;
  const isExpiringSoon = daysRemaining > 0 && daysRemaining <= 7;

  let formatted = '';
  if (isExpired) {
    formatted = `Expired ${Math.abs(daysRemaining)}d ago`;
  } else if (daysRemaining === 1) {
    formatted = 'Expires tomorrow';
  } else {
    formatted = `${daysRemaining} days left`;
  }

  return {
    daysRemaining,
    isExpired,
    isExpiringSoon,
    formatted,
  };
}

/**
 * Returns color classes for account status badge
 */
export function getAccountStatusBadge(status: string): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  switch (status) {
    case 'ACTIVE':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        border: 'border-emerald-500/20',
        label: 'Active',
      };
    case 'EXPIRED':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
        border: 'border-amber-500/20',
        label: 'Token Expired',
      };
    case 'DISCONNECTED':
      return {
        bg: 'bg-zinc-500/10',
        text: 'text-zinc-400',
        border: 'border-zinc-500/20',
        label: 'Disconnected',
      };
    case 'ERROR':
    default:
      return {
        bg: 'bg-rose-500/10',
        text: 'text-rose-400',
        border: 'border-rose-500/20',
        label: 'Auth Error',
      };
  }
}

/**
 * Returns styling for job status badge
 */
export function getJobStatusBadge(status: string): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  switch (status) {
    case 'COMPLETED':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        border: 'border-emerald-500/20',
        label: 'Live on Shorts',
      };
    case 'UPLOADING_YOUTUBE':
      return {
        bg: 'bg-blue-500/10',
        text: 'text-blue-400',
        border: 'border-blue-500/20',
        label: 'Uploading YouTube',
      };
    case 'STORED_DRIVE':
      return {
        bg: 'bg-cyan-500/10',
        text: 'text-cyan-400',
        border: 'border-cyan-500/20',
        label: 'Saved to Drive',
      };
    case 'DOWNLOADING':
      return {
        bg: 'bg-indigo-500/10',
        text: 'text-indigo-400',
        border: 'border-indigo-500/20',
        label: 'Downloading Reel',
      };
    case 'DETECTED':
      return {
        bg: 'bg-purple-500/10',
        text: 'text-purple-400',
        border: 'border-purple-500/20',
        label: 'Reel Detected',
      };
    case 'RETRYING':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
        border: 'border-amber-500/20',
        label: 'Retrying',
      };
    case 'FAILED':
    default:
      return {
        bg: 'bg-rose-500/10',
        text: 'text-rose-400',
        border: 'border-rose-500/20',
        label: 'Failed',
      };
  }
}
