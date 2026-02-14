export async function getUserProfile(token) {
  const url = "https://api.amazon.com/user/profile";
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    if (!res.ok) {
      console.log("PROFILE_FAIL:", res.status);
      return null;
    }

    const json = await res.json();
    return json; // { user_id: "...", name: "...", email: "..." }
  } catch (err) {
    console.log("PROFILE_ERROR:", { message: err?.message });
    return null;
  }
}
