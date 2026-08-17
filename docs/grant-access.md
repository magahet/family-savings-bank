# Letting someone else deploy your Family Savings Bank

Deploying is a self-serve process (see the [deploy guide](../README.md#deploy-your-own-instance)),
but if you'd rather have someone help — a more technical friend or family member — you can
grant them access to deploy and maintain the app on **your** Firebase project. You stay the
owner and pay any (tiny) bills; they get permission to deploy code and run the setup scripts.
It takes about two minutes.

> **Be aware:** the roles below (**Owner** especially) give that person broad access to your
> Firebase project — well beyond just this app. Only grant it to someone you trust, and know
> that you can **revoke it at any time** (see [When they're done](#when-theyre-done-optional)).

## Before you start

- Your project must already exist and be on the **Blaze** plan (this is [step 1–2 of the
  deploy guide](../README.md#deploy-your-own-instance)). If it isn't, do that first —
  those steps involve billing, which only you can set up.
- Have the helper's **Google account email** handy. You'll add it as a member.

## Steps

1. Go to the [Firebase Console](https://console.firebase.google.com) and open your project.
2. Click the **gear icon** (top-left, next to "Project Overview") → **Users and permissions**.
3. Click **Add member**.
4. Paste in the helper's Google account email.
5. Set the role — pick one (see the comparison below):
   - **Owner** — guaranteed to cover everything the deploy needs, so permissions won't need
     to be touched again mid-setup. Also the broadest access; grant only if you trust them
     fully.
   - **Editor** *(recommended)* — more limited; enough for a normal deploy, but if a step
     turns out to need a permission it doesn't include, you'd have to come back and change
     the role.
6. Click **Add member**.
7. Give the helper your **Project ID** (gear → Project settings → it's listed at the top,
   e.g. `smith-family-bank`).

That's it. The helper uses their own Google login, so **there's nothing secret for you to
send them**.

## Which role to pick

| | **Owner** | **Editor** (recommended) |
|---|---|---|
| Deploy site, functions, rules | ✅ | ✅ |
| Run the admin setup scripts | ✅ | ✅ |
| Guaranteed no missing permissions | ✅ | ⚠️ may need a change if a step needs more |
| Change billing / delete the project | ✅ | ❌ |
| Add or remove other people | ✅ | ❌ |

**Editor** is the safer default: it's enough for a normal deploy but can't touch billing,
delete the project, or manage members — at the small risk of needing a one-time bump if a
deploy step turns out to require more. **Owner** is the "it just works" choice, letting them
do the whole setup without you revisiting permissions, but it grants full control of the
project. Either way you remain an Owner and can remove their access whenever you like.

## When they're done (optional)

You can remove their access at any time without affecting the running app:

- gear → **Users and permissions** → find their email → **Remove**.
