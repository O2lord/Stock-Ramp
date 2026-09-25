import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as DiscordClient, EmbedBuilder, TextChannel } from "discord.js";

// Database types
interface UserSubscription {
  id: string;
  discord_user_id: string;
  discord_channel_id?: string;
  wallet_address: string;
  notification_preferences?: NotificationPreferences;
  created_at: string;
  updated_at: string;
}

interface NotificationPreferences {
  trust_vault_created?: boolean;
  buy_order_created?: boolean;
  tokens_reserved?: boolean;
  payment_sent?: boolean;
  payment_confirmed?: boolean;
  withdrawal_event?: boolean;
  reservation_cancelled?: boolean;
  dispute_created?: boolean;
  dispute_resolved?: boolean;
  buy_order_reserved?: boolean;
  buyer_payment_sent?: boolean;
  seller_confirms_payment?: boolean;
  buy_order_cancelled?: boolean;
  buy_order_reduced?: boolean;
  price_updated?: boolean;
  trust_vault_closed?: boolean;

  /**TRUST EXPRESS */
  express_buy_order_created?: boolean;
  express_buy_order_cancelled?: boolean;
  express_buy_order_reduced?: boolean;
  instant_payment_reserved?: boolean;
  instant_payment_payout_result?: boolean;
  express_sell_order_created?: boolean;
  instant_sell_reservation_created?: boolean;
  instant_sell_payment_result?: boolean;
  [key: string]: boolean | undefined;
}

interface NotificationLog {
  id: string;
  user_subscription_id: string;
  event_type: string;
  notification_sent: boolean;
  error_message?: string;
  created_at: string;
}

interface EventParticipants {
  buyer?: string;
  seller?: string;
  disputer?: string;
  disputerAddress?: string;
  otherPartyAddress?: string;
  resolver?: string;
  participant1?: string;
  participant2?: string;
  participant3?: string;
  [key: string]: string | undefined;
  maker?: string;
  user?: string;
}

interface NotificationEvent {
  type: string;
  participants: EventParticipants;
  data: Record<string, unknown>;
}

interface NotificationStats {
  total: number;
  successful: number;
  failed: number;
  byEventType: Record<string, {
    total: number;
    successful: number;
    failed: number;
  }>;
}

type EventTypeKey =
  | 'BuyOrderCreatedEvent'
  | 'SellOrderCreatedEvent'
  | 'BuyOrderCancelledEvent'
  | 'BuyOrderReducedEvent'
  | 'InstantPaymentReservedEvent'
  | 'InstantPaymentPayoutQueuedEvent'
  | 'InstantPaymentPayoutResultEvent'
  | 'InstantSellReservationCreatedEvent'
  | 'InstantSellPaymentResultEvent'
  | 'PartialWithdrawalEvent'
  | 'OrderClosedEvent'
  | 'OrderNearlyEmptyEvent'
  | 'PriceUpdatedEvent'
  | 'ValidatorVoteExecutedEvent';

type UserRole = 'buyer' | 'seller' | 'taker' | 'maker' | 'user';


type RoleMapping = {
  [K in EventTypeKey]?: Partial<Record<UserRole, string>>;
};

enum DiscordErrorCode {
  CANNOT_SEND_DM = 50007,
  UNKNOWN_USER = 10013,
  MISSING_ACCESS = 50001,
  UNKNOWN_CHANNEL = 10003,
}

interface NotificationError extends Error {
  code?: number;
  discordCode?: DiscordErrorCode;
  retryable?: boolean;
}

/**
 * Handles notification delivery to Discord users
 */
export class NotificationManager {
  private readonly client: DiscordClient;
  private readonly supabase: SupabaseClient;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; 

  constructor(discordClient: DiscordClient) {
    this.client = discordClient;
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required Supabase environment variables');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /**
   * Send notifications to all relevant users for an event
   */
  async sendEventNotifications(
    event: NotificationEvent, 
    embed: EmbedBuilder
  ): Promise<string[]> {
    const participants = event.participants || {};
    const notificationsSent: string[] = [];

    // Send notifications to all participants
    for (const [role, walletAddress] of Object.entries(participants)) {
      if (walletAddress && this.isValidRole(role)) {
        try {
          const sent = await this.sendNotificationToWallet(
            walletAddress,
            this.getEventTypeForRole(event.type, role as UserRole),
            embed
          );
          notificationsSent.push(...sent);
        } catch (error) {
          console.error(`Failed to send notification for role ${role}:`, error);
        }
      }
    }

    return notificationsSent;
  }

  /**
   * Send notification to users with a specific wallet address
   */
  async sendNotificationToWallet(
    walletAddress: string, 
    eventType: string, 
    embed: EmbedBuilder
  ): Promise<string[]> {
     if (!this.isValidWalletAddress(walletAddress)) {
      console.error(`Invalid wallet address: ${walletAddress}`);
      return [];
    }
    try {
      const { data: subscriptions, error } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("wallet_address", walletAddress)
        .returns<UserSubscription[]>();

      if (error) {
        console.error(
          "❌ NotificationManager: Error fetching subscriptions:",
          error
        );
        return [];
      }

      if (!subscriptions || subscriptions.length === 0) {
        return [];
      }

      const notificationsSent: string[] = [];

      for (const subscription of subscriptions || []) {
         try {
          const isEnabled = this.isNotificationEnabled(subscription, eventType);

          if (isEnabled) {
            const success = await this.sendDiscordNotificationWithRetry(
              subscription,
              embed
            );
            
            if (success) {
              notificationsSent.push(subscription.discord_user_id);
              await this.logNotification(subscription.id, eventType, true);
            } else {
              await this.logNotification(
                subscription.id,
                eventType,
                false,
                "Failed to send Discord message after retries"
              );
            }
          } else {
          }
        } catch (error) {
          console.error(`Error processing subscription ${subscription.id}:`, error);
          await this.logNotification(
            subscription.id,
            eventType,
            false,
            error instanceof Error ? error.message : "Unknown error"
          );
        }
      }


      return notificationsSent;
    } catch (error) {
      console.error(
        "❌ NotificationManager: Error sending notifications to wallet:",
        error
      );
      return [];
    }
  }

    /**
   * Send Discord notification with retry logic
   */
  private async sendDiscordNotificationWithRetry(
    subscription: UserSubscription,
    embed: EmbedBuilder,
    attempt: number = 1
  ): Promise<boolean> {
    try {
      return await this.sendDiscordNotification(subscription, embed);
    } catch (error) {
      const notificationError = error as NotificationError;
      
     
      if (attempt < this.maxRetries && this.isRetryableError(notificationError)) { 
        await this.delay(this.retryDelay * attempt);
        return this.sendDiscordNotificationWithRetry(subscription, embed, attempt + 1);
      }
      
      throw error;
    }
  }

  /**
   * Send notification to a specific Discord user - now public for external access
   */
  async sendDiscordNotification(
    subscription: UserSubscription, 
    embed: EmbedBuilder
  ): Promise<boolean> {
    try {
      if (subscription.discord_channel_id) {
       
        const channel = await this.client.channels.fetch(
          subscription.discord_channel_id
        );
        
        if (channel && channel.isTextBased()) {
          await (channel as TextChannel).send({ embeds: [embed] });
          return true;
        } else {
          console.warn(`Channel ${subscription.discord_channel_id} is not text-based or not found`);
          return false;
        }
      } else {
       
        const user = await this.client.users.fetch(subscription.discord_user_id);
        
        if (user) {
          await user.send({ embeds: [embed] });
          return true;
        } else {
          console.warn(`User ${subscription.discord_user_id} not found`);
          return false;
        }
      }
    } catch (error: unknown) {
      const discordError = error as NotificationError;
      discordError.discordCode = (error as { code?: number }).code as DiscordErrorCode;
      
      console.error(`Error sending Discord notification to ${subscription.discord_user_id}:`, error);

     
      discordError.retryable = this.isRetryableError(discordError);

     
      this.logDiscordError(discordError, subscription);

      throw discordError;
    }
  }

  /**
   * Check if notification is enabled for user
   */
  private isNotificationEnabled(subscription: UserSubscription, eventType: string): boolean {
    if (!subscription.notification_preferences) {
     
      return true;
    }
    
    const preference = subscription.notification_preferences[eventType];
   
    return preference !== false;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: NotificationError): boolean {
   
    const nonRetryableErrors = [
      DiscordErrorCode.CANNOT_SEND_DM,
      DiscordErrorCode.UNKNOWN_USER,
      DiscordErrorCode.UNKNOWN_CHANNEL,
    ];

    if (error.discordCode && nonRetryableErrors.includes(error.discordCode)) {
      return false;
    }

   
    return true;
  }

  /**
 * Log Discord-specific errors with more detail
 */
private logDiscordError(error: NotificationError, subscription: UserSubscription): void {
  console.error(`Discord error for user ${subscription.discord_user_id}:`);
  
  if (error.discordCode === DiscordErrorCode.CANNOT_SEND_DM) {
    console.error("Cannot send DM to user - they may have DMs disabled");
  } else if (error.discordCode === DiscordErrorCode.UNKNOWN_USER) {
    console.error("Unknown user - user may have left servers or blocked the bot");
  } else if (error.discordCode === DiscordErrorCode.MISSING_ACCESS) {
    console.error("Missing access - bot may not have permission to send messages");
  } else if (error.discordCode === DiscordErrorCode.UNKNOWN_CHANNEL) {
    console.error("Unknown channel - channel may have been deleted");
  }
}

  /**
   * Utility function for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate wallet address format
   */
  private isValidWalletAddress(address: string): boolean {
   
    const base58Pattern = /^[A-HJ-NP-Za-km-z1-9]{32,44}$/;
    return base58Pattern.test(address);
  }

  /**
   * Validate user role
   */
  private isValidRole(role: string): role is UserRole {
    const validRoles: UserRole[] = ['buyer', 'seller', 'taker', 'maker', 'user'];
    return validRoles.includes(role as UserRole);
  }

  /**
   * Log notification attempt to database
   */
  private async logNotification(
    userSubscriptionId: string,
    eventType: string,
    success: boolean,
    errorMessage: string | null = null
  ): Promise<void> {
    try {
      await this.supabase.from("notification_logs").insert({
        user_subscription_id: userSubscriptionId,
        event_type: eventType,
        notification_sent: success,
        error_message: errorMessage,
      });
    } catch (error) {
      console.error(
        "❌ NotificationManager: Error logging notification:",
        error
      );
    }
  }

  /**
   * Map event types to role-specific notification preferences
   */
  getEventTypeForRole(eventType: string, role: UserRole): string {
   const roleMapping: RoleMapping = {
  BuyOrderCreatedEvent: { buyer: 'buy_order_created' },
  SellOrderCreatedEvent: { seller: 'sell_order_created' },
  BuyOrderCancelledEvent: { buyer: 'buy_order_cancelled' },
  BuyOrderReducedEvent: { buyer: 'buy_order_reduced' },
  InstantPaymentReservedEvent: { taker: 'instant_payment_reserved', user: 'instant_payment_reserved' },
  InstantPaymentPayoutQueuedEvent: { taker: 'instant_payment_payout_queued', user: 'instant_payment_payout_queued' },
  InstantPaymentPayoutResultEvent: { taker: 'instant_payment_payout_result', user: 'instant_payment_payout_result' },
  InstantSellReservationCreatedEvent: {
    seller: 'instant_sell_reservation_created',
    maker: 'instant_sell_reservation_created',
    buyer: 'instant_sell_reservation_created',
    taker: 'instant_sell_reservation_created',
  },
  InstantSellPaymentResultEvent: {
    seller: 'instant_sell_payment_result',
    maker: 'instant_sell_payment_result',
    buyer: 'instant_sell_payment_result',
    taker: 'instant_sell_payment_result',
  },
  PartialWithdrawalEvent: { maker: 'partial_withdrawal', seller: 'partial_withdrawal' },
  OrderClosedEvent: { maker: 'order_closed', seller: 'order_closed', buyer: 'order_closed' },
  OrderNearlyEmptyEvent: { maker: 'order_nearly_empty' },
  PriceUpdatedEvent: { maker: 'price_updated', seller: 'price_updated' },
  ValidatorVoteExecutedEvent: {
    maker: 'validator_vote_executed',
    seller: 'validator_vote_executed',
    buyer: 'validator_vote_executed',
    taker: 'validator_vote_executed',
  },
};

    const mappedType = roleMapping[eventType as EventTypeKey]?.[role];
    if (mappedType) {
      return mappedType;
    }

    // Fallback: convert event type to lowercase preference key
    const fallbackType = eventType.toLowerCase().replace("event", "");
    return fallbackType;
  }

  /**
   * Send bulk notifications to multiple users
   */
  async sendBulkNotifications(
    walletAddresses: string[], 
    eventType: string, 
    embed: EmbedBuilder
  ): Promise<string[]> {
    const allNotificationsSent: string[] = [];

    for (const walletAddress of walletAddresses) {
      const sent = await this.sendNotificationToWallet(
        walletAddress,
        eventType,
        embed
      );
      allNotificationsSent.push(...sent);
    }

    return allNotificationsSent;
  }

  /**
   * Get notification statistics for monitoring
   */
  async getNotificationStats(timeframe: string = "24 hours"): Promise<NotificationStats | null> {
    try {
      const { data, error } = await this.supabase
        .from("notification_logs")
        .select("notification_sent, event_type")
        .gte(
          "created_at",
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        )
        .returns<Pick<NotificationLog, 'notification_sent' | 'event_type'>[]>();

      if (error) {
        console.error("❌ NotificationManager: Error fetching stats:", error);
        return null;
      }

      const stats: NotificationStats = {
        total: data.length,
        successful: data.filter((log) => log.notification_sent).length,
        failed: data.filter((log) => !log.notification_sent).length,
        byEventType: {},
      };

      // Group by event type
      for (const log of data) {
        if (!stats.byEventType[log.event_type]) {
          stats.byEventType[log.event_type] = {
            total: 0,
            successful: 0,
            failed: 0,
          };
        }
        stats.byEventType[log.event_type].total++;
        if (log.notification_sent) {
          stats.byEventType[log.event_type].successful++;
        } else {
          stats.byEventType[log.event_type].failed++;
        }
      }

      return stats;
    } catch (error) {
      console.error("❌ NotificationManager: Error calculating stats:", error);
      return null;
    }
  }

  /**
   * Clean up old notification logs
   */
  async cleanupOldLogs(daysToKeep: number = 30): Promise<boolean> {
    try {
      const cutoffDate = new Date(
        Date.now() - daysToKeep * 24 * 60 * 60 * 1000
      );

      const { error } = await this.supabase
        .from("notification_logs")
        .delete()
        .lt("created_at", cutoffDate.toISOString());

      if (error) {
        console.error("❌ NotificationManager: Error cleaning up logs:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("❌ NotificationManager: Error during cleanup:", error);
      return false;
    }
  }

  /**
   * Get user preferences for notifications
   */
  async getUserPreferences(discordUserId: string): Promise<NotificationPreferences | null> {
    try {
      const { data, error } = await this.supabase
        .from("user_subscriptions")
        .select("notification_preferences")
        .eq("discord_user_id", discordUserId)
        .single();

      if (error || !data) {
        return null;
      }

      return data.notification_preferences || {};
    } catch (error) {
      console.error("Error fetching user preferences:", error);
      return null;
    }
  }

    /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    discordUserId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from("user_subscriptions")
        .update({ notification_preferences: preferences })
        .eq("discord_user_id", discordUserId);

      if (error) {
        console.error("Error updating user preferences:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error updating preferences:", error);
      return false;
    }
  }
  
}

// Export types for use in other modules
export type {
  UserSubscription,
  NotificationPreferences,
  NotificationLog,
  NotificationEvent,
  EventParticipants,
  NotificationStats,
  EventTypeKey,
  UserRole,
  RoleMapping,
  NotificationError
};