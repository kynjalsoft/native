package com.anonymous.bulwarkmobile

internal class MailPreviewGate {
    data class Ticket(val generation: Long, val accountId: String?, val accountGeneration: Long)

    private val lock = Any()
    private var generation = 0L
    private var enabled: Boolean? = null
    private val accountGenerations = mutableMapOf<String, Long>()

    fun snapshot(accountId: String? = null): Ticket = synchronized(lock) {
        Ticket(generation, accountId, accountId?.let { accountGenerations[it] } ?: 0L)
    }

    fun update(enabled: Boolean, stored: () -> Boolean?, persist: (Boolean) -> Boolean, dismiss: () -> Unit) {
        synchronized(lock) {
            val savedValue = stored()
            if (savedValue == enabled && (this.enabled == null || this.enabled == enabled)) {
                this.enabled = enabled
                return
            }
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

    fun dismiss(accountId: String?, cancel: () -> Unit) {
        synchronized(lock) {
            if (accountId == null) generation += 1
            else accountGenerations[accountId] = (accountGenerations[accountId] ?: 0L) + 1
            cancel()
        }
    }

    fun postIfCurrent(snapshot: Ticket, previews: Boolean, previewEnabled: () -> Boolean, post: () -> Unit): Boolean =
        synchronized(lock) {
            if (snapshot.generation != generation ||
                snapshot.accountGeneration != (snapshot.accountId?.let { accountGenerations[it] } ?: 0L) ||
                (previews && (enabled == false || !previewEnabled()))) return@synchronized false
            post()
            true
        }
}
