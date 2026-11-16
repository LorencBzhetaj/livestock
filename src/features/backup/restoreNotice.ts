const restoreChannel = 'livestockos-restore'
let channel: BroadcastChannel | undefined

export function listenForRestore(onRestore: () => void) {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const listener = new BroadcastChannel(restoreChannel)
    channel = listener
    listener.onmessage = ({ data }) => {
      if (data === 'restored') onRestore()
    }
    return () => {
      if (channel === listener) channel = undefined
      listener.close()
    }
  } catch {
    // Dexie still observes committed database changes.
  }
}

export function notifyRestore() {
  try {
    // A BroadcastChannel does not deliver messages to its sending endpoint.
    channel?.postMessage('restored')
  } catch {
    // A failed notification cannot undo a committed restore.
  }
}
