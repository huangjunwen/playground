// WASI Preview 1 ABI constants: enum/flag/scalar values.
// Struct sizes live in struct.ts, co-located with each layout.
//
// ABI reference: wasi-libc libc-bottom-half/headers/public/wasi/wasip1.h
// (mirrors wasi_snapshot_preview1.witx). Values track its #defines; each
// group's leading comment names the backing C type (u8/u16/u32/u64) and the
// ABI field that carries the value.

// filetype — u8 (__wasi_filetype_t). Carried by fdstat.fs_filetype,
// filestat.filetype, dirent.d_type.
export const Filetype = {
  UNKNOWN: 0, // Type unknown or none of the below.
  BLOCK_DEVICE: 1, // Block device inode.
  CHARACTER_DEVICE: 2, // Character device inode.
  DIRECTORY: 3, // Directory inode.
  REGULAR_FILE: 4, // Regular file inode.
  SOCKET_DGRAM: 5, // Datagram socket.
  SOCKET_STREAM: 6, // Byte-stream socket.
  SYMBOLIC_LINK: 7, // Symbolic link inode.
} as const;

// fdflags — u16 (__wasi_fdflags_t). Carried by fdstat.fs_flags; set via
// fd_fdstat_set_flags.
export const FdFlags = {
  APPEND: 1 << 0, // Data written is always appended to the file's end.
  DSYNC: 1 << 1, // Writes synchronized for data integrity (data only).
  NONBLOCK: 1 << 2, // Non-blocking mode.
  RSYNC: 1 << 3, // Synchronized reads.
  SYNC: 1 << 4, // Writes synchronized for file integrity (data + metadata).
} as const;

// rights — u64 (__wasi_rights_t). Carried by fdstat.fs_rights_base and
// fdstat.fs_rights_inheriting; gate which syscalls an fd may call.
// NOTE: at runtime this host only enforces the FD_READ/FD_WRITE direction
// bits (WASI spec §6.5); the full set is listed for ABI fidelity.
export const Rights = {
  FD_DATASYNC: 1n << 0n, // fd_datasync.
  FD_READ: 1n << 1n, // fd_read / sock_recv (and fd_pread if FD_SEEK).
  FD_SEEK: 1n << 2n, // fd_seek (implies FD_TELL).
  FD_FDSTAT_SET_FLAGS: 1n << 3n, // fd_fdstat_set_flags.
  FD_SYNC: 1n << 4n, // fd_sync.
  FD_TELL: 1n << 5n, // fd_tell.
  FD_WRITE: 1n << 6n, // fd_write / sock_send (and fd_pwrite if FD_SEEK).
  FD_ADVISE: 1n << 7n, // fd_advise.
  FD_ALLOCATE: 1n << 8n, // fd_allocate.
  PATH_CREATE_DIRECTORY: 1n << 9n, // path_create_directory.
  PATH_CREATE_FILE: 1n << 10n, // path_open with oflags::creat.
  PATH_LINK_SOURCE: 1n << 11n, // path_link source dir.
  PATH_LINK_TARGET: 1n << 12n, // path_link target dir.
  PATH_OPEN: 1n << 13n, // path_open.
  FD_READDIR: 1n << 14n, // fd_readdir.
  PATH_READLINK: 1n << 15n, // path_readlink.
  PATH_RENAME_SOURCE: 1n << 16n, // path_rename source dir.
  PATH_RENAME_TARGET: 1n << 17n, // path_rename target dir.
  PATH_FILESTAT_GET: 1n << 18n, // path_filestat_get.
  PATH_FILESTAT_SET_SIZE: 1n << 19n, // path_filestat_set_size (+ oflags::trunc).
  PATH_FILESTAT_SET_TIMES: 1n << 20n, // path_filestat_set_times.
  FD_FILESTAT_GET: 1n << 21n, // fd_filestat_get.
  FD_FILESTAT_SET_SIZE: 1n << 22n, // fd_filestat_set_size.
  FD_FILESTAT_SET_TIMES: 1n << 23n, // fd_filestat_set_times.
  PATH_SYMLINK: 1n << 24n, // path_symlink.
  PATH_REMOVE_DIRECTORY: 1n << 25n, // path_remove_directory.
  PATH_UNLINK_FILE: 1n << 26n, // path_unlink_file.
  POLL_FD_READWRITE: 1n << 27n, // poll_oneoff fd_read/fd_write.
  SOCK_SHUTDOWN: 1n << 28n, // sock_shutdown.
  SOCK_ACCEPT: 1n << 29n, // sock_accept.
} as const;

// advice — u8 (__wasi_advice_t). Carried by fd_advise.
export const Advice = {
  NORMAL: 0, // No advice.
  SEQUENTIAL: 1, // Access sequentially, low offset to high.
  RANDOM: 2, // Access in random order.
  WILLNEED: 3, // Access in the near future.
  DONTNEED: 4, // Will not access in the near future.
  NOREUSE: 5, // Access once, then no reuse.
} as const;

// fstflags — u16 (__wasi_fstflags_t). Carried by fd_filestat_set_times and
// path_filestat_set_times (fst_flags).
export const Fstflags = {
  ATIM: 1 << 0, // Set atim to the given timestamp.
  ATIM_NOW: 1 << 1, // Set atim to clock_realtime now.
  MTIM: 1 << 2, // Set mtim to the given timestamp.
  MTIM_NOW: 1 << 3, // Set mtim to clock_realtime now.
} as const;

// oflags — u16 (__wasi_oflags_t). Carried by path_open (oflags).
export const Oflags = {
  CREAT: 1 << 0, // Create file if it does not exist.
  DIRECTORY: 1 << 1, // Fail if not a directory.
  EXCL: 1 << 2, // Fail if file already exists (with CREAT).
  TRUNC: 1 << 3, // Truncate file to size 0.
} as const;

// lookupflags — u32 (__wasi_lookupflags_t). Carried by path_open and the
// path_* syscalls (lookupflags).
export const LOOKUPFLAGS_SYMLINK_FOLLOW = 1 << 0; // Expand symlinks along the resolved path.

// whence — u8 (__wasi_whence_t). Carried by fd_seek (whence).
export const Whence = {
  SET: 0, // Seek relative to start-of-file.
  CUR: 1, // Seek relative to current position.
  END: 2, // Seek relative to end-of-file.
} as const;

// clockid — u32 (__wasi_clockid_t). Carried by clock_time_get / clock_res_get
// (id) and subscription_u.clock.id.
export const CLOCKID = {
  REALTIME: 0, // Real time; epoch 1970-01-01T00:00:00Z.
  MONOTONIC: 1, // Store-wide monotonic clock; epoch undefined.
  PROCESS_CPUTIME_ID: 2, // CPU-time clock of the current process.
  THREAD_CPUTIME_ID: 3, // CPU-time clock of the current thread.
} as const;

// eventtype — u8 (__wasi_eventtype_t). Carried by subscription.u.tag and
// event.type.
export const EVENTTYPE = {
  CLOCK: 0, // Clock reached subscription_clock::timeout.
  FD_READ: 1, // fd has data available for reading.
  FD_WRITE: 2, // fd has capacity available for writing.
} as const;

// subclockflags — u16 (__wasi_subclockflags_t). Carried by
// subscription_u.clock.flags.
export const SUBSCRIPTION_CLOCK_ABSTIME = 1 << 0; // Treat timeout as absolute (else relative to now).

// eventrwflags — u16 (__wasi_eventrwflags_t). Carried by
// event.fd_readwrite.flags.
export const EVENTRWFLAGS_FD_READWRITE_HANGUP = 1 << 0; // Peer closed or disconnected.

// preopentype — u8 (__wasi_preopentype_t). Carried by prestat.tag.
export const PREOPENTYPE_DIR = 0; // A pre-opened directory.

// riflags — u16 (__wasi_riflags_t). Carried by sock_recv (ri_flags).
export const Riflags = {
  RECV_PEEK: 1 << 0, // Return message without removing it from the receive queue.
  RECV_WAITALL: 1 << 1, // On stream sockets, block until the full amount can be returned.
} as const;

// roflags — u16 (__wasi_roflags_t). Returned by sock_recv (ro_flags).
export const ROFLAGS_RECV_DATA_TRUNCATED = 1 << 0; // Message data has been truncated.

// sdflags — u8 (__wasi_sdflags_t). Carried by sock_shutdown (sdflags).
export const Sdflags = {
  RD: 1 << 0, // Disables further receive operations.
  WR: 1 << 1, // Disables further send operations.
} as const;

// errno — u16 (__wasi_errno_t). Returned by every WASI syscall and carried by
// event.error. Keys use POSIX names (E-prefix); values track wasip1.h.
export const Result = {
  SUCCESS: 0, // No error.
  E2BIG: 1, // Argument list too long.
  EACCES: 2, // Permission denied.
  EADDRINUSE: 3, // Address in use.
  EADDRNOTAVAIL: 4, // Address not available.
  EAFNOSUPPORT: 5, // Address family not supported.
  EAGAIN: 6, // Resource unavailable, or operation would block.
  EALREADY: 7, // Connection already in progress.
  EBADF: 8, // Bad file descriptor.
  EBADMSG: 9, // Bad message.
  EBUSY: 10, // Device or resource busy.
  ECANCELED: 11, // Operation canceled.
  ECHILD: 12, // No child processes.
  ECONNABORTED: 13, // Connection aborted.
  ECONNREFUSED: 14, // Connection refused.
  ECONNRESET: 15, // Connection reset.
  EDEADLK: 16, // Resource deadlock would occur.
  EDESTADDRREQ: 17, // Destination address required.
  EDOM: 18, // Mathematics argument out of domain of function.
  EDQUOT: 19, // Reserved.
  EEXIST: 20, // File exists.
  EFAULT: 21, // Bad address.
  EFBIG: 22, // File too large.
  EHOSTUNREACH: 23, // Host is unreachable.
  EIDRM: 24, // Identifier removed.
  EILSEQ: 25, // Illegal byte sequence.
  EINPROGRESS: 26, // Operation in progress.
  EINTR: 27, // Interrupted function.
  EINVAL: 28, // Invalid argument.
  EIO: 29, // I/O error.
  EISCONN: 30, // Socket is connected.
  EISDIR: 31, // Is a directory.
  ELOOP: 32, // Too many levels of symbolic links.
  EMFILE: 33, // File descriptor value too large.
  EMLINK: 34, // Too many links.
  EMSGSIZE: 35, // Message too large.
  EMULTIHOP: 36, // Reserved.
  ENAMETOOLONG: 37, // Filename too long.
  ENETDOWN: 38, // Network is down.
  ENETRESET: 39, // Connection aborted by network.
  ENETUNREACH: 40, // Network unreachable.
  ENFILE: 41, // Too many files open in system.
  ENOBUFS: 42, // No buffer space available.
  ENODEV: 43, // No such device.
  ENOENT: 44, // No such file or directory.
  ENOEXEC: 45, // Executable file format error.
  ENOLCK: 46, // No locks available.
  ENOLINK: 47, // Reserved.
  ENOMEM: 48, // Not enough space.
  ENOMSG: 49, // No message of the desired type.
  ENOPROTOOPT: 50, // Protocol not available.
  ENOSPC: 51, // No space left on device.
  ENOSYS: 52, // Function not supported.
  ENOTCONN: 53, // The socket is not connected.
  ENOTDIR: 54, // Not a directory or a symlink to a directory.
  ENOTEMPTY: 55, // Directory not empty.
  ENOTRECOVERABLE: 56, // State not recoverable.
  ENOTSOCK: 57, // Not a socket.
  ENOTSUP: 58, // Not supported, or operation not supported on socket.
  ENOTTY: 59, // Inappropriate I/O control operation.
  ENXIO: 60, // No such device or address.
  EOVERFLOW: 61, // Value too large to be stored in data type.
  EOWNERDEAD: 62, // Previous owner died.
  EPERM: 63, // Operation not permitted.
  EPIPE: 64, // Broken pipe.
  EPROTO: 65, // Protocol error.
  EPROTONOSUPPORT: 66, // Protocol not supported.
  EPROTOTYPE: 67, // Protocol wrong type for socket.
  ERANGE: 68, // Result too large.
  EROFS: 69, // Read-only file system.
  ESPIPE: 70, // Invalid seek.
  ESRCH: 71, // No such process.
  ESTALE: 72, // Reserved.
  ETIMEDOUT: 73, // Connection timed out.
  ETXTBSY: 74, // Text file busy.
  EXDEV: 75, // Cross-device link.
  ENOTCAPABLE: 76, // Extension: capabilities insufficient.
} as const;
