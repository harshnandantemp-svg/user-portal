import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from '@mui/material';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowLeftRounded from '@mui/icons-material/KeyboardArrowLeftRounded';
import KeyboardArrowRightRounded from '@mui/icons-material/KeyboardArrowRightRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';

const theme = createTheme({
  typography: {
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
  },
  palette: {
    background: {
      default: '#f8fbff',
    },
  },
});

const DEFAULT_API_BASE_URLS = [
  'https://api.demoopwr.in/api/v1/quarantine',
];

// Configure one or more compatible quarantine APIs.
// The frontend tries them in order, so localhost can be primary and another
// system on the LAN can be the backup if the local backend goes down.
const parseApiBaseUrls = () => {
  const configuredUrls = (
    import.meta.env.VITE_QUARANTINE_API_BASES
    || import.meta.env.VITE_QUARANTINE_API_BASE
    || DEFAULT_API_BASE_URLS.join(',')
  );

  return [
    ...new Set(
      configuredUrls
        .split(',')
        .map((url) => url.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  ];
};

const API_BASE_URLS = parseApiBaseUrls();

// These statuses usually mean the current API cannot serve the dashboard right
// now, so it is safe to try the next configured backend.
const shouldTryNextApi = (status) => [404, 408, 500, 502, 503, 504].includes(status);

// Shared fetch helper for backend failover.
// It returns the first successful response, or the final failed response if the
// error should not be retried, such as validation/auth errors.
const apiFetchWithFallback = async (path, options = {}) => {
  let lastError = null;
  const attemptedUrls = [];

  for (let index = 0; index < API_BASE_URLS.length; index += 1) {
    const baseUrl = API_BASE_URLS[index];
    const url = `${baseUrl}${path}`;
    attemptedUrls.push(baseUrl);

    try {
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
      });
      const hasBackup = index < API_BASE_URLS.length - 1;

      if (response.ok || !hasBackup || !shouldTryNextApi(response.status)) {
        return { response, baseUrl };
      }

      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `All quarantine APIs failed (${attemptedUrls.join(' -> ')}): ${lastError?.message || 'unknown error'}`,
  );
};

const DEFAULT_USER_EMAIL = 'raiprerna144@gmail.com';
const AUTH_STORAGE_KEY = 'quarantine_magic_profile';
const LEGACY_AUTH_STORAGE_KEY = 'quarantine_magic_session';

const actionOptions = [
  'Release',
  'Release and Allow sender',
  'Release and Allow domain',
  'Block Sender',
];

const dateRangeOptions = [
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom Range' },
];

const demoRows = [
  {
    id: 'mail-001',
    quarantineTime: '2026-04-27 11:32',
    subject: 'Project Files - Compressed Folder',
    recipient: 'raiprerna144@gmail.com',
    sender: 'preeti42001preeti@gmail.com',
    date: '2026-04-27',
  },
  {
    id: 'mail-002',
    quarantineTime: '2026-04-27 11:34',
    subject: 'Invoice Attached - Immediate Review Required',
    recipient: 'raiprerna144@gmail.com',
    sender: 'preeti42001preeti@gmail.com',
    date: '2026-04-27',
  },
];

// Accept a few common response shapes so another backend can integrate without
// forcing the frontend to know the exact database/table implementation.
const extractRows = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.messages)) {
    return payload.messages;
  }

  if (Array.isArray(payload?.quarantine)) {
    return payload.quarantine;
  }

  return [];
};

// Backend pagination should return total. If an older API only returns rows,
// fall back to the visible row count so the table still renders.
const extractTotal = (payload, rowCount) => {
  const total = Number(payload?.total ?? payload?.count ?? payload?.totalRows);
  return Number.isFinite(total) ? total : rowCount;
};

// API dates can be ISO timestamps or already-formatted strings. Keep the UI
// stable by formatting valid timestamps and leaving unknown formats unchanged.
const formatQuarantineTime = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

// Normalize backend field names into the table contract used by this page.
// This is the main adapter if another project uses message_id, qTime, emailDate,
// from_email, or other slightly different field names.
const normalizeQuarantineRow = (row, index) => ({
  id: String(row.id ?? row.message_id ?? row.messageId ?? row.gmail_id ?? `mail-${index + 1}`),
  quarantineTime: formatQuarantineTime(
    row.quarantineTime ?? row.qTime ?? row.quarantine_time ?? row.created_at ?? row.received_at ?? row.date_time ?? '',
  ),
  subject: row.subject ?? row.email_subject ?? row.title ?? '(no subject)',
  recipient: row.recipient ?? row.to ?? row.user_email ?? row.mailbox ?? DEFAULT_USER_EMAIL,
  sender: row.sender ?? row.from ?? row.from_email ?? row.sender_email ?? '',
  date: row.date ?? row.emailDate ?? row.email_date ?? row.created_date ?? row.received_date ?? '',
});

// Convert menu labels into backend-friendly action names.
const actionToApiValue = (label) => label.toLowerCase().replaceAll(' ', '_');

const formatDateParam = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPresetDateRange = (preset) => {
  if (preset !== 'last_7_days' && preset !== 'last_30_days') {
    return {};
  }

  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (preset === 'last_30_days' ? 29 : 6));

  return {
    startDate: formatDateParam(start),
    endDate: formatDateParam(end),
  };
};

const headerCellSx = {
  height: 64,
  bgcolor: '#fbfcff',
  color: '#33445f',
  fontWeight: 900,
  fontSize: 13,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  borderBottom: '1px solid #dce3ee',
  whiteSpace: 'nowrap',
};

const bodyCellSx = {
  height: 56,
  color: '#07111f',
  fontSize: 15,
  borderBottom: '1px solid #e3e7ee',
  whiteSpace: 'nowrap',
};

function App() {
  const [authSession, setAuthSession] = useState(() => {
    try {
      localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      const storedSession = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
      if (storedSession?.accessToken) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return null;
      }
      if (storedSession?.expiresAt && new Date(storedSession.expiresAt) <= new Date()) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return null;
      }
      return storedSession?.email ? storedSession : null;
    } catch {
      return null;
    }
  });
  const [loginEmail, setLoginEmail] = useState(DEFAULT_USER_EMAIL);
  const [loginMessage, setLoginMessage] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authChecking, setAuthChecking] = useState(false);
  const [rows, setRows] = useState(demoRows);
  const [selectedIds, setSelectedIds] = useState([]);
  const [actionsAnchorEl, setActionsAnchorEl] = useState(null);
  const [subjectQuery, setSubjectQuery] = useState('');
  const [senderQuery, setSenderQuery] = useState('');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [emailDate, setEmailDate] = useState('');
  const [dateRangePreset, setDateRangePreset] = useState('last_7_days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalRows, setTotalRows] = useState(demoRows.length);
  const [isLoading, setIsLoading] = useState(false);
  const [apiMessage, setApiMessage] = useState('');
  const [apiError, setApiError] = useState('');
  const [activeApiBase, setActiveApiBase] = useState('');
  const [releaseDialog, setReleaseDialog] = useState({
    open: false,
    title: '',
    message: '',
  });
  const verifyingTokenRef = useRef('');
  const isAuthenticated = Boolean(authSession?.email);

  // Load one page from the backend. Search and date filtering are intentionally
  // sent as query params so large quarantine queues are filtered by the backend,
  // not by the browser after downloading every row.
  const loadQuarantineRows = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setIsLoading(true);
    setApiError('');

    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(rowsPerPage),
        user_email: authSession.email,
      });
      const subject = subjectQuery.trim();
      const sender = senderQuery.trim();
      const recipient = recipientQuery.trim();

      if (subject) {
        params.set('subject', subject);
      }
      if (sender) {
        params.set('sender', sender);
      }
      if (recipient) {
        params.set('recipient', recipient);
      }
      if (emailDate) {
        params.set('emailDate', emailDate);
      }
      if (dateRangePreset === 'custom') {
        if (customStartDate) {
          params.set('startDate', customStartDate);
        }
        if (customEndDate) {
          params.set('endDate', customEndDate);
        }
      } else {
        const presetRange = getPresetDateRange(dateRangePreset);
        if (presetRange.startDate) {
          params.set('startDate', presetRange.startDate);
        }
        if (presetRange.endDate) {
          params.set('endDate', presetRange.endDate);
        }
      }

      const { response, baseUrl } = await apiFetchWithFallback(`/user?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
      });
      setActiveApiBase(baseUrl);

      if (!response.ok) {
        if (response.status === 401) {
          clearAuthSession(false);
        }
        throw new Error(`User quarantine API returned ${response.status} from ${baseUrl}`);
      }

      const payload = await response.json();
      const nextRows = extractRows(payload).map(normalizeQuarantineRow);
      setRows(nextRows);
      setTotalRows(extractTotal(payload, nextRows.length));
      setSelectedIds([]);
      setApiMessage(`Loaded ${nextRows.length} quarantine message${nextRows.length === 1 ? '' : 's'} from ${baseUrl}.`);
    } catch (error) {
      setApiError(error.message || 'Could not load quarantine messages.');
    } finally {
      setIsLoading(false);
    }
  }, [
    authSession,
    customEndDate,
    customStartDate,
    dateRangePreset,
    emailDate,
    isAuthenticated,
    page,
    recipientQuery,
    rowsPerPage,
    senderQuery,
    subjectQuery,
  ]);

  useEffect(() => {
    if (isAuthenticated) {
      loadQuarantineRows();
    }
  }, [isAuthenticated, loadQuarantineRows]);

  const visibleRows = rows;

  const allSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(row.id));
  const indeterminate = selectedIds.length > 0 && !allSelected;
  const actionsOpen = Boolean(actionsAnchorEl);

  const rowRangeLabel = useMemo(() => {
    const from = totalRows > 0 ? page * rowsPerPage + 1 : 0;
    const to = Math.min((page + 1) * rowsPerPage, totalRows);

    return totalRows > 0
      ? `${from}-${to} of ${totalRows}`
      : '0 of 0'
  }, [page, rowsPerPage, totalRows]);

  const canGoBack = page > 0;
  const canGoForward = (page + 1) * rowsPerPage < totalRows;

  const toggleRow = (id) => {
    setSelectedIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ));
  };

  const toggleAll = () => {
    const visibleIds = visibleRows.map((row) => row.id);

    setSelectedIds((current) => (
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])]
    ));
  };

  const handleSubjectChange = (event) => {
    setSubjectQuery(event.target.value);
    setPage(0);
  };

  const handleSenderChange = (event) => {
    setSenderQuery(event.target.value);
    setPage(0);
  };

  const handleRecipientChange = (event) => {
    setRecipientQuery(event.target.value);
    setPage(0);
  };

  const handleEmailDateChange = (event) => {
    setEmailDate(event.target.value);
    setPage(0);
  };

  const handleDateRangePresetChange = (event) => {
    setDateRangePreset(event.target.value);
    setPage(0);
  };

  const handleCustomStartDateChange = (event) => {
    setCustomStartDate(event.target.value);
    setPage(0);
  };

  const handleCustomEndDateChange = (event) => {
    setCustomEndDate(event.target.value);
    setPage(0);
  };

  const handleRowsPerPageChange = (event) => {
    setRowsPerPage(Number(event.target.value));
    setPage(0);
  };

  const openActionsMenu = (event) => {
    setActionsAnchorEl(event.currentTarget);
  };

  const closeActionsMenu = () => {
    setActionsAnchorEl(null);
  };

  const saveAuthSession = (session) => {
    // Only non-sensitive profile data is stored in browser storage. The real
    // session token is an HttpOnly cookie set by the backend, so JavaScript
    // cannot read or leak it.
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    setAuthSession(session);
  };

  const clearAuthSession = (notifyBackend = true) => {
    localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthSession(null);
    setRows([]);
    setSelectedIds([]);
    setApiMessage('');
    setApiError('');

    if (notifyBackend) {
      apiFetchWithFallback('/auth/logout', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
      }).catch(() => {
        // If the API is already down, local logout should still complete.
      });
    }
  };

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token || authSession?.email) {
      return;
    }

    let cancelled = false;

    const restoreCookieSession = async () => {
      setAuthChecking(true);
      try {
        const { response, baseUrl } = await apiFetchWithFallback('/auth/session', {
          headers: {
            Accept: 'application/json',
          },
        });
        setActiveApiBase(baseUrl);

        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        if (!cancelled && payload.email) {
          saveAuthSession({ email: payload.email });
        }
      } catch {
        // No valid cookie yet. Keep the login screen quiet.
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    };

    restoreCookieSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleMagicLinkRequest = async (event) => {
    event.preventDefault();
    setAuthChecking(true);
    setLoginError('');
    setLoginMessage('');

    try {
      const { response, baseUrl } = await apiFetchWithFallback('/auth/magic/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ email: loginEmail }),
      });
      setActiveApiBase(baseUrl);

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || `Magic link API returned ${response.status}`);
      }

      setLoginMessage(payload.message || 'Magic link generated. Check the backend terminal and open the printed link.');
    } catch (error) {
      setLoginError(error.message || 'Could not request magic link.');
    } finally {
      setAuthChecking(false);
    }
  };

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      return;
    }
    if (verifyingTokenRef.current === token) {
      return;
    }
    verifyingTokenRef.current = token;

    const verifyMagicToken = async () => {
      setAuthChecking(true);
      setLoginError('');
      setLoginMessage('Verifying magic link...');

      try {
        const { response, baseUrl } = await apiFetchWithFallback('/auth/magic/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ token }),
        });
        setActiveApiBase(baseUrl);

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.detail || `Magic link verify returned ${response.status}`);
        }

        saveAuthSession({
          email: payload.email,
          expiresAt: payload.expires_at,
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (error) {
        setLoginError(error.message || 'Magic link could not be verified.');
      } finally {
        setAuthChecking(false);
      }
    };

    verifyMagicToken();
  }, []);

  // Submit the selected quarantine action. The payload includes several common
  // ID aliases so this page can work with slightly different backend contracts.
  const handleAction = async (label) => {
    closeActionsMenu();

    if (selectedIds.length === 0) {
      setApiMessage('Select at least one quarantine message first.');
      setApiError('');
      return;
    }

    setIsLoading(true);
    setApiError('');
    setApiMessage('');

    try {
      const selectedMessageIds = selectedIds.map((id) => {
        const numericId = Number(id);
        return Number.isNaN(numericId) ? id : numericId;
      });
      const primaryMessageId = selectedMessageIds[0];

      const { response, baseUrl } = await apiFetchWithFallback('/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          action: actionToApiValue(label),
          id: primaryMessageId,
          ids: selectedMessageIds,
          message_id: primaryMessageId,
          message_ids: selectedMessageIds,
          user_email: authSession.email,
        }),
      });
      setActiveApiBase(baseUrl);

      if (!response.ok) {
        let detail = '';

        try {
          const errorPayload = await response.json();
          detail = JSON.stringify(errorPayload.detail ?? errorPayload);
        } catch {
          detail = await response.text();
        }

        throw new Error(`Restore API returned ${response.status} from ${baseUrl}${detail ? `: ${detail}` : ''}`);
      }

      setRows((current) => current.filter((row) => !selectedIds.includes(row.id)));
      setTotalRows((current) => Math.max(0, current - selectedIds.length));
      setApiMessage(`${label} completed for ${selectedIds.length} message${selectedIds.length === 1 ? '' : 's'}.`);
      setReleaseDialog({
        open: true,
        title: label === 'Block Sender' ? 'Sender block submitted' : 'Release request submitted',
        message: label === 'Block Sender'
          ? 'The selected sender has been sent for blocking. Future messages from this sender may be restricted based on policy.'
          : `Your selected mail${selectedIds.length === 1 ? '' : 's'} will be released shortly. It can take a few moments to appear back in the mailbox.`,
      });
      setSelectedIds([]);
    } catch (error) {
      setApiError(error.message || 'Could not submit quarantine action.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            bgcolor: '#f6f8fc',
            px: 2,
          }}
        >
          <Paper
            component="form"
            onSubmit={handleMagicLinkRequest}
            elevation={0}
            sx={{
              width: '100%',
              maxWidth: 520,
              p: 4,
              borderRadius: 2.5,
              border: '1px solid #dde5f0',
              boxShadow: '0 24px 70px rgba(15, 23, 42, 0.12)',
              bgcolor: '#ffffff',
            }}
          >
            <Stack spacing={2.2}>
              <Stack direction="row" spacing={1.2} alignItems="center">
                <Avatar
                  variant="rounded"
                  sx={{
                    width: 38,
                    height: 38,
                    bgcolor: '#202031',
                    color: '#ffffff',
                    fontWeight: 900,
                    letterSpacing: '-0.08em',
                  }}
                >
                  TF
                </Avatar>
                <Box>
                  <Typography sx={{ color: '#111827', fontSize: 24, fontWeight: 900 }}>
                    User Portal
                  </Typography>
                  <Typography sx={{ color: '#64748b', fontSize: 14 }}>
                    Sign in with a one-time magic link.
                  </Typography>
                </Box>
              </Stack>

              <TextField
                label="Email address"
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                fullWidth
                required
              />

              <Button
                type="submit"
                disabled={authChecking}
                variant="contained"
                sx={{
                  minHeight: 48,
                  bgcolor: '#e51b2c',
                  textTransform: 'none',
                  fontWeight: 900,
                  '&:hover': { bgcolor: '#c91625' },
                }}
              >
                {authChecking ? 'Working...' : 'Send magic link'}
              </Button>

              {(loginMessage || loginError) && (
                <Typography sx={{ color: loginError ? '#b91c1c' : '#33445f', fontSize: 14, fontWeight: 700 }}>
                  {loginError || loginMessage}
                </Typography>
              )}

              <Typography sx={{ color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
                For this demo, the backend prints the magic link in the terminal instead of sending email.
              </Typography>
            </Stack>
          </Paper>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f5f7fb' }}>
          <Box
            component="aside"
            sx={{
              width: 216,
              flexShrink: 0,
              bgcolor: '#202031',
              color: '#ffffff',
              borderRight: '1px solid #2d2e42',
              boxShadow: '10px 0 30px rgba(15, 23, 42, 0.12)',
              pt: 2.2,
              px: 1.6,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3.2, px: 0.2 }}>
              <Avatar
                variant="rounded"
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: 1,
                  bgcolor: '#ffffff',
                  color: '#202031',
                  fontSize: 15,
                  fontWeight: 900,
                  letterSpacing: '-0.08em',
                }}
              >
                TF
              </Avatar>
              <Typography sx={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.03em' }}>
                User Portal
              </Typography>
            </Stack>

            <Button
              fullWidth
              sx={{
                minHeight: 36,
                justifyContent: 'flex-start',
                gap: 1.1,
                px: 1.2,
                borderRadius: 1,
                bgcolor: '#e51b2c',
                color: '#ffffff',
                textTransform: 'none',
                fontSize: 14,
                fontWeight: 900,
                boxShadow: '0 12px 22px rgba(229, 27, 44, 0.22)',
                '&:hover': {
                  bgcolor: '#d81929',
                },
              }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  width: 17,
                  height: 17,
                  border: '2px solid #ffffff',
                  borderRadius: 0.4,
                  position: 'relative',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: 3,
                    bgcolor: '#ffffff',
                    borderRadius: 0.2,
                  },
                }}
              />
              Quarantine
            </Button>
          </Box>

          <Box sx={{ flex: 1, display: 'flex', minWidth: 0, flexDirection: 'column' }}>
            <Box
              component="header"
              sx={{
                height: 58,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2.4,
                bgcolor: '#ffffff',
                borderBottom: '1px solid #e5e9f0',
                boxShadow: '0 2px 12px rgba(15, 23, 42, 0.04)',
              }}
            >
              <Typography sx={{ color: '#111827', fontSize: 28, fontWeight: 900, letterSpacing: '-0.045em' }}>
                Quarantine Management
              </Typography>
              <Stack direction="row" spacing={1.1} alignItems="center">
                <Avatar sx={{ width: 28, height: 28, bgcolor: '#f1f3f7', color: '#202031', fontSize: 14, fontWeight: 900 }}>
                  {authSession.email.slice(0, 1).toUpperCase()}
                </Avatar>
                <Typography sx={{ color: '#1f2937', fontSize: 12, fontWeight: 800 }}>
                  {authSession.email}
                </Typography>
                <IconButton aria-label="Contact admin" sx={{ color: '#4b5563' }}>
                  <HelpOutlineRounded sx={{ fontSize: 20 }} />
                </IconButton>
                <Button
                  onClick={clearAuthSession}
                  sx={{
                    minHeight: 34,
                    px: 1.7,
                    color: '#202031',
                    border: '1px solid #d9dee8',
                    borderRadius: 1,
                    textTransform: 'none',
                    fontWeight: 800,
                    '&:hover': {
                      bgcolor: '#f3f5f8',
                      borderColor: '#c8cfdb',
                    },
                  }}
                >
                  Sign out
                </Button>
              </Stack>
            </Box>

          <Box
            component="main"
            sx={{
              flex: 1,
              minWidth: 0,
              p: 2.4,
              bgcolor: '#f6f8fc',
            }}
          >
            <Paper
              elevation={0}
              sx={{
                p: 2.2,
                mb: 1.8,
                borderRadius: 1.2,
                border: '1px solid #e2e8f0',
                boxShadow: '0 10px 24px rgba(15, 23, 42, 0.04)',
                bgcolor: '#ffffff',
              }}
            >
              <Stack spacing={1.8}>
                <Typography sx={{ color: '#8a96aa', fontSize: 13, fontWeight: 900, letterSpacing: '0.08em' }}>
                  QUICK FILTER
                </Typography>
                <Stack direction="row" alignItems="center" spacing={1.1}>
                  <TextField
                    value={subjectQuery}
                    onChange={handleSubjectChange}
                    placeholder="Subject"
                    size="small"
                    sx={{
                      width: 170,
                      '& .MuiOutlinedInput-root': {
                        minHeight: 40,
                        borderRadius: 0.5,
                        bgcolor: '#ffffff',
                        color: '#33445f',
                        fontSize: 14,
                        '& fieldset': {
                          borderColor: '#cfd6e2',
                        },
                        '&:hover fieldset': {
                          borderColor: '#c5d1e3',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#e51b2c',
                        },
                      },
                    }}
                  />
                  <TextField
                    value={senderQuery}
                    onChange={handleSenderChange}
                    placeholder="Sender"
                    size="small"
                    sx={{
                      width: 170,
                      '& .MuiOutlinedInput-root': {
                        minHeight: 40,
                        borderRadius: 0.5,
                        bgcolor: '#ffffff',
                        color: '#33445f',
                        fontSize: 14,
                        '& fieldset': {
                          borderColor: '#cfd6e2',
                        },
                        '&:hover fieldset': {
                          borderColor: '#c5d1e3',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#e51b2c',
                        },
                      },
                    }}
                  />
                  <TextField
                    value={recipientQuery}
                    onChange={handleRecipientChange}
                    placeholder="Recipient"
                    size="small"
                    sx={{
                      width: 170,
                      '& .MuiOutlinedInput-root': {
                        minHeight: 40,
                        borderRadius: 0.5,
                        bgcolor: '#ffffff',
                        color: '#33445f',
                        fontSize: 14,
                        '& fieldset': {
                          borderColor: '#cfd6e2',
                        },
                        '&:hover fieldset': {
                          borderColor: '#c5d1e3',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#e51b2c',
                        },
                      },
                    }}
                  />
                  <TextField
                    label="Email Date"
                    type="date"
                    value={emailDate}
                    onChange={handleEmailDateChange}
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    sx={{
                      width: 170,
                      '& .MuiOutlinedInput-root': {
                        minHeight: 44,
                        borderRadius: 0.5,
                        color: '#07111f',
                        fontSize: 14,
                        '& fieldset': {
                          borderColor: '#2f73ff',
                          borderWidth: 1.5,
                        },
                        '&:hover fieldset': {
                          borderColor: '#2f73ff',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#2f73ff',
                        },
                      },
                      '& .MuiInputLabel-root': {
                        color: '#2f73ff',
                        fontSize: 12,
                      },
                      '& .MuiInputLabel-root.Mui-focused': {
                        color: '#2f73ff',
                      },
                    }}
                  />
                  <IconButton
                    onClick={loadQuarantineRows}
                    disabled={isLoading}
                    sx={{ color: '#e51b2c', border: '1px solid #cfd6e2', width: 38, height: 38 }}
                  >
                    <RefreshRounded sx={{ fontSize: 20 }} />
                  </IconButton>
                  <Box sx={{ flex: 1 }} />
                  <FormControl size="small">
                    <Select
                      value={dateRangePreset}
                      onChange={handleDateRangePresetChange}
                      IconComponent={KeyboardArrowDownRounded}
                      sx={{
                        minWidth: 118,
                        height: 34,
                        borderRadius: 1,
                        bgcolor: '#ffffff',
                        color: '#111827',
                        fontSize: 13,
                        fontWeight: 800,
                        '& .MuiSelect-select': {
                          py: 0.75,
                          pl: 1.4,
                          pr: '28px !important',
                        },
                        '& fieldset': {
                          borderColor: '#d5dbe5',
                        },
                        '&:hover fieldset': {
                          borderColor: '#c8d0dc',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#c8d0dc',
                          borderWidth: 1,
                        },
                      }}
                    >
                      {dateRangeOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {dateRangePreset === 'custom' && (
                    <>
                      <TextField
                        type="date"
                        value={customStartDate}
                        onChange={handleCustomStartDateChange}
                        size="small"
                        sx={{
                          width: 138,
                          '& .MuiOutlinedInput-root': {
                            height: 34,
                            borderRadius: 1,
                            fontSize: 13,
                          },
                        }}
                      />
                      <TextField
                        type="date"
                        value={customEndDate}
                        onChange={handleCustomEndDateChange}
                        size="small"
                        sx={{
                          width: 138,
                          '& .MuiOutlinedInput-root': {
                            height: 34,
                            borderRadius: 1,
                            fontSize: 13,
                          },
                        }}
                      />
                    </>
                  )}
                  <Typography sx={{ color: '#50627d', fontSize: 15, fontWeight: 800 }}>
                    {selectedIds.length} selected
                  </Typography>
                  <Button
                    startIcon={<SettingsRounded />}
                    endIcon={<KeyboardArrowDownRounded />}
                    onClick={openActionsMenu}
                    sx={{
                      minWidth: 144,
                      minHeight: 48,
                      borderRadius: 1,
                      color: '#50627d',
                      border: '1px solid #cfd6e2',
                      textTransform: 'none',
                      fontSize: 16,
                      fontWeight: 500,
                    }}
                  >
                    Actions
                  </Button>
                  <Menu
                    anchorEl={actionsAnchorEl}
                    open={actionsOpen}
                    onClose={closeActionsMenu}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    PaperProps={{
                      sx: {
                        mt: 0.8,
                        minWidth: 238,
                        borderRadius: 1.2,
                        border: '1px solid #d7e0ef',
                        boxShadow: '0 14px 34px rgba(15, 23, 42, 0.16)',
                      },
                    }}
                  >
                    {actionOptions.map((option) => (
                      <MenuItem
                        key={option}
                        onClick={() => handleAction(option)}
                        sx={{
                          minHeight: 46,
                          fontSize: 15,
                          fontWeight: 700,
                          color: option === 'Block Sender' ? '#b91c1c' : '#1f2937',
                        }}
                      >
                        {option}
                      </MenuItem>
                    ))}
                  </Menu>
                </Stack>
                {(apiMessage || apiError || isLoading) && (
                  <Typography
                    sx={{
                      color: apiError ? '#b91c1c' : '#50627d',
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    {isLoading ? 'Connecting to quarantine API...' : (apiError || apiMessage)}
                  </Typography>
                )}
              </Stack>
            </Paper>

            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                width: '100%',
                overflow: 'hidden',
                borderRadius: 2,
                border: '1px solid #d7dee9',
                boxShadow: '0 2px 4px rgba(15, 23, 42, 0.16)',
                bgcolor: '#ffffff',
              }}
            >
              <Table sx={{ minWidth: 0, width: '100%', tableLayout: 'fixed' }}>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ ...headerCellSx, width: 58, textAlign: 'center' }}>
                      <Checkbox
                        checked={allSelected}
                        indeterminate={indeterminate}
                        onChange={toggleAll}
                        sx={{
                          color: '#6b7280',
                          '& .MuiSvgIcon-root': { fontSize: 27 },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ ...headerCellSx, width: 172 }}>Quarantine Time</TableCell>
                    <TableCell sx={{ ...headerCellSx, width: 345 }}>Subject (Contains)</TableCell>
                    <TableCell sx={{ ...headerCellSx, width: 245 }}>Recipient</TableCell>
                    <TableCell sx={{ ...headerCellSx, width: 260 }}>Sender</TableCell>
                    <TableCell sx={{ ...headerCellSx, width: 128 }}>Date</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell padding="checkbox" sx={{ ...bodyCellSx, textAlign: 'center' }}>
                        <Checkbox
                          checked={selectedIds.includes(row.id)}
                          onChange={() => toggleRow(row.id)}
                          sx={{
                            color: '#6b7280',
                            '& .MuiSvgIcon-root': { fontSize: 27 },
                          }}
                        />
                      </TableCell>
                      <TableCell sx={bodyCellSx}>{row.quarantineTime}</TableCell>
                      <TableCell sx={bodyCellSx}>
                        <Typography
                          component="span"
                          sx={{
                            display: 'block',
                            color: '#d0021b',
                            fontSize: 15,
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {row.subject}
                        </Typography>
                      </TableCell>
                      <TableCell sx={bodyCellSx}>{row.recipient}</TableCell>
                      <TableCell sx={bodyCellSx}>{row.sender}</TableCell>
                      <TableCell sx={bodyCellSx}>{row.date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Stack
                direction="row"
                alignItems="center"
                justifyContent="flex-end"
                spacing={2.2}
                sx={{
                  minHeight: 62,
                  px: 2.5,
                  borderTop: '1px solid #e3e7ee',
                  bgcolor: '#ffffff',
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ color: '#111827', fontSize: 15 }}>
                    Rows per page:
                  </Typography>
                  <FormControl variant="standard" size="small">
                    <Select
                      value={rowsPerPage}
                      onChange={handleRowsPerPageChange}
                      disableUnderline
                      IconComponent={KeyboardArrowDownRounded}
                      sx={{
                        minWidth: 56,
                        color: '#111827',
                        fontSize: 15,
                        '& .MuiSelect-select': {
                          py: 0,
                          pr: '24px !important',
                        },
                      }}
                    >
                      <MenuItem value={10}>10</MenuItem>
                      <MenuItem value={25}>25</MenuItem>
                      <MenuItem value={50}>50</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>

                <Typography sx={{ color: '#111827', fontSize: 15 }}>
                  {rowRangeLabel}
                </Typography>

                <Stack direction="row" spacing={1}>
                  <IconButton disabled={!canGoBack || isLoading} onClick={() => setPage((current) => Math.max(0, current - 1))} size="small">
                    <KeyboardArrowLeftRounded sx={{ fontSize: 28 }} />
                  </IconButton>
                  <IconButton disabled={!canGoForward || isLoading} onClick={() => setPage((current) => current + 1)} size="small">
                    <KeyboardArrowRightRounded sx={{ fontSize: 28 }} />
                  </IconButton>
                </Stack>
              </Stack>
            </TableContainer>
          </Box>
        </Box>
      </Box>
      <Dialog
        open={releaseDialog.open}
        onClose={() => setReleaseDialog((current) => ({ ...current, open: false }))}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)',
          },
        }}
      >
        <DialogTitle sx={{ fontSize: 22, fontWeight: 900, color: '#111827', pb: 1 }}>
          {releaseDialog.title}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#33445f', fontSize: 15.5, lineHeight: 1.6 }}>
            {releaseDialog.message}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button
            variant="contained"
            onClick={() => setReleaseDialog((current) => ({ ...current, open: false }))}
            sx={{
              bgcolor: '#e51b2c',
              textTransform: 'none',
              fontWeight: 800,
              px: 2.4,
              '&:hover': {
                bgcolor: '#c91625',
              },
            }}
          >
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

export default App;



