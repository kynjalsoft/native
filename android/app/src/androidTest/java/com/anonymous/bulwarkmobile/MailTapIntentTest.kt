package com.anonymous.bulwarkmobile

import android.app.PendingIntent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MailTapIntentTest {
    @Test
    fun collidingJavaHashesKeepDistinctMessageTapIntents() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val firstId = "mail:[\"staff\",\"primary\",\"Aa\"]"
        val secondId = "mail:[\"staff\",\"primary\",\"BB\"]"
        assertEquals(firstId.hashCode(), secondId.hashCode())

        val firstIntent = mailTapIntent(context, "message", firstId).apply {
            putExtra(NotificationTapStore.EXTRA_EMAIL_ID, "Aa")
        }
        val secondIntent = mailTapIntent(context, "message", secondId).apply {
            putExtra(NotificationTapStore.EXTRA_EMAIL_ID, "BB")
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val first = PendingIntent.getActivity(context, 0, firstIntent, flags)
        val second = PendingIntent.getActivity(context, 0, secondIntent, flags)
        try {
            assertNotEquals(first, second)
            val lookupFlags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            assertNotNull(PendingIntent.getActivity(context, 0, firstIntent, lookupFlags))
            assertNotNull(PendingIntent.getActivity(context, 0, secondIntent, lookupFlags))
        } finally {
            first.cancel()
            second.cancel()
        }
    }
}
