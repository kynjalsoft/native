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
        gate.update(true, { enabled = it; true }, {})
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
        gate.update(false, { enabled = it; true }, {})
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
    fun optOutDismissesPostThatAlreadyEnteredNativeGate() {
        val gate = MailPreviewGate()
        var enabled = false
        gate.update(true, { enabled = it; true }, {})
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
        val optOut = Thread { gate.update(false, { enabled = it; true }, { dismissed.set(true) }) }
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
}
