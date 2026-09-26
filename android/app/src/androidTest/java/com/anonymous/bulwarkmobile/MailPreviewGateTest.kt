package com.anonymous.bulwarkmobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MailPreviewGateTest {
    @Test
    fun previewOptOutWhileIconLoadsPreventsRichPost() {
        val gate = MailPreviewGate()
        var enabled = false
        gate.update(true, { enabled }, { enabled = it; true }, {})
        val generation = gate.snapshot()
        val fetching = CountDownLatch(1)
        val resume = CountDownLatch(1)
        val posted = AtomicBoolean(false)
        val accepted = AtomicBoolean(true)
        val worker = Thread {
            fetching.countDown()
            if (resume.await(5, TimeUnit.SECONDS)) {
                accepted.set(gate.postIfCurrent(generation, true, { enabled }) { posted.set(true) })
            }
        }
        worker.start()
        assertTrue(fetching.await(5, TimeUnit.SECONDS))
        gate.update(false, { enabled }, { enabled = it; true }, {})
        resume.countDown()
        worker.join(5000)
        assertFalse(worker.isAlive)
        assertFalse(accepted.get())
        assertFalse(posted.get())
    }

    @Test
    fun unknownPreferenceAllowsOnlyPrivateGenericPost() {
        val gate = MailPreviewGate()
        val generation = gate.snapshot()
        var richPosted = false
        var genericPosted = false
        assertFalse(gate.postIfCurrent(generation, true, { false }) { richPosted = true })
        assertTrue(gate.postIfCurrent(generation, false, { false }) { genericPosted = true })
        assertFalse(richPosted)
        assertTrue(genericPosted)
    }

    @Test
    fun savedPreviewChoiceSurvivesHeadlessProcessStart() {
        val gate = MailPreviewGate()
        var richPosted = false
        assertTrue(gate.postIfCurrent(gate.snapshot(), true, { true }) { richPosted = true })
        assertTrue(richPosted)
    }

    @Test
    fun unchangedHydrationDoesNotDiscardAnInFlightPost() {
        val gate = MailPreviewGate()
        var saved = true
        val ticket = gate.snapshot("staff")
        gate.update(true, { saved }, { saved = it; true }, {})
        var posted = false
        assertTrue(gate.postIfCurrent(ticket, true, { saved }) { posted = true })
        assertTrue(posted)
    }

    @Test
    fun accountDismissalInvalidatesOnlyItsPendingPosts() {
        val gate = MailPreviewGate()
        var saved = false
        gate.update(true, { saved }, { saved = it; true }, {})
        val removed = gate.snapshot("removed")
        val surviving = gate.snapshot("surviving")
        val fetching = CountDownLatch(1)
        val resume = CountDownLatch(1)
        val posted = AtomicBoolean(false)
        val worker = Thread {
            fetching.countDown()
            if (resume.await(5, TimeUnit.SECONDS)) {
                gate.postIfCurrent(removed, true, { saved }) { posted.set(true) }
            }
        }
        worker.start()
        assertTrue(fetching.await(5, TimeUnit.SECONDS))
        val dismissed = AtomicBoolean(false)
        gate.dismiss("removed") { dismissed.set(true) }
        resume.countDown()
        worker.join(5000)
        assertFalse(worker.isAlive)
        assertTrue(dismissed.get())
        assertFalse(posted.get())
        assertTrue(gate.postIfCurrent(surviving, true, { saved }) {})
    }

    @Test
    fun optOutDismissesPostThatAlreadyEnteredNativeGate() {
        val gate = MailPreviewGate()
        var enabled = false
        gate.update(true, { enabled }, { enabled = it; true }, {})
        val generation = gate.snapshot()
        val posting = CountDownLatch(1)
        val finishPost = CountDownLatch(1)
        val dismissed = AtomicBoolean(false)
        val worker = Thread {
            gate.postIfCurrent(generation, true, { enabled }) {
                posting.countDown()
                finishPost.await(5, TimeUnit.SECONDS)
            }
        }
        worker.start()
        assertTrue(posting.await(5, TimeUnit.SECONDS))
        val optOut = Thread { gate.update(false, { enabled }, { enabled = it; true }, { dismissed.set(true) }) }
        optOut.start()
        assertFalse(dismissed.get())
        finishPost.countDown()
        worker.join(5000)
        optOut.join(5000)
        assertFalse(worker.isAlive)
        assertFalse(optOut.isAlive)
        assertTrue(dismissed.get())
        assertFalse(enabled)
    }

    @Test
    fun accountDismissalWaitsForPostingThenCancelsIt() {
        val gate = MailPreviewGate()
        var saved = false
        gate.update(true, { saved }, { saved = it; true }, {})
        val ticket = gate.snapshot("removed")
        val posting = CountDownLatch(1)
        val finishPost = CountDownLatch(1)
        val dismissed = AtomicBoolean(false)
        val worker = Thread {
            gate.postIfCurrent(ticket, true, { saved }) {
                posting.countDown()
                finishPost.await(5, TimeUnit.SECONDS)
            }
        }
        worker.start()
        assertTrue(posting.await(5, TimeUnit.SECONDS))
        val logout = Thread { gate.dismiss("removed") { dismissed.set(true) } }
        logout.start()
        assertFalse(dismissed.get())
        finishPost.countDown()
        worker.join(5000)
        logout.join(5000)
        assertFalse(worker.isAlive)
        assertFalse(logout.isAlive)
        assertTrue(dismissed.get())
    }

    @Test
    fun accountDisabledBeforeNativeCallCannotPostUntilActivated() {
        val disabled = mutableMapOf<String, Boolean>()
        val gate = MailPreviewGate()
        gate.dismiss("removed", true, { disabled["removed"] = true; true }) {}
        val late = gate.snapshot("removed")
        var posted = false
        assertFalse(gate.postIfCurrent(late, false, { false }, { disabled["removed"] ?: true }) {
            posted = true
        })
        assertFalse(posted)

        val restarted = MailPreviewGate()
        assertFalse(restarted.postIfCurrent(restarted.snapshot("removed"), false, { false },
            { disabled["removed"] ?: true }) { posted = true })
        restarted.activate("survivor") { disabled["survivor"] = false; true }
        assertTrue(restarted.postIfCurrent(restarted.snapshot("survivor"), false, { false },
            { disabled["survivor"] ?: true }) { posted = true })

        restarted.activate("removed") { disabled["removed"] = false; true }
        assertTrue(restarted.postIfCurrent(restarted.snapshot("removed"), false, { false },
            { disabled["removed"] ?: true }) { posted = true })
    }
}
