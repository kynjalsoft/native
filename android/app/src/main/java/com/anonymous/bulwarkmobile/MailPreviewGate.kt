package com.anonymous.bulwarkmobile

internal class MailPreviewGate {
    private val lock = Any()
    private var generation = 0L
    private var enabled: Boolean? = null

    fun snapshot(): Long = synchronized(lock) { generation }

    fun update(enabled: Boolean, persist: (Boolean) -> Boolean, dismiss: () -> Unit) {
        synchronized(lock) {
            if (!enabled) this.enabled = false
            generation += 1
            val saved = try {
                persist(enabled)
            } finally {
                if (!enabled) dismiss()
            }
            if (!saved) throw IllegalStateException("Mail preview preference could not be saved")
            this.enabled = enabled
        }
    }

    fun postIfCurrent(snapshot: Long, previews: Boolean, previewEnabled: () -> Boolean, post: () -> Unit): Boolean =
        synchronized(lock) {
            if (snapshot != generation || (previews && (enabled == false || !previewEnabled()))) return@synchronized false
            post()
            true
        }
}
