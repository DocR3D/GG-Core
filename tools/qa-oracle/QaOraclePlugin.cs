using System.Net;
using System.Text;
using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Utils;

namespace GGCore.QaOracle;

/// <summary>
/// Plugin QA strictement réservé à l'environnement de dev / CI (profil cs2-qa).
/// Expose l'état mémoire réel du serveur CS2 en HTTP (:27080) pour comparer avec GG-Core.
/// </summary>
public class QaOraclePlugin : BasePlugin
{
    public override string ModuleName => "GGCore.QaOracle";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "GG-Core";
    public override string ModuleDescription => "HTTP QA Oracle for automated CS2 Golden Tests";

    private HttpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _listenTask;

    public override void Load(bool hotReload)
    {
        _cts = new CancellationTokenSource();
        _listener = new HttpListener();
        _listener.Prefixes.Add("http://+:27080/");
        _listener.Start();

        _listenTask = Task.Run(() => ListenLoopAsync(_cts.Token));
        Console.WriteLine("[GGCore.QaOracle] HTTP QA Oracle listening on :27080");
    }

    public override void Unload(bool hotReload)
    {
        try
        {
            _cts?.Cancel();
            _listener?.Stop();
            _listener?.Close();
        }
        catch
        {
            // Ignore shutdown errors
        }
        Console.WriteLine("[GGCore.QaOracle] Stopped.");
    }

    private async Task ListenLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener != null && _listener.IsListening)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await _listener.GetContextAsync();
            }
            catch (HttpListenerException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GGCore.QaOracle] Listener error: {ex.Message}");
                continue;
            }

            _ = Task.Run(() => HandleRequestAsync(ctx), ct);
        }
    }

    private async Task HandleRequestAsync(HttpListenerContext ctx)
    {
        var path = ctx.Request.Url?.AbsolutePath ?? "/";
        var method = ctx.Request.HttpMethod.ToUpperInvariant();

        try
        {
            if (method == "GET" && path == "/qa/health")
            {
                var json = await RunOnMainThreadAsync(() => JsonSerializer.Serialize(new
                {
                    ok = true,
                    plugin = ModuleName,
                    version = ModuleVersion,
                    map = Server.MapName
                }));
                await WriteJsonAsync(ctx.Response, 200, json);
                return;
            }

            if (method == "GET" && path == "/qa/state")
            {
                var json = await RunOnMainThreadAsync(ReadGameStateJson);
                await WriteJsonAsync(ctx.Response, 200, json);
                return;
            }

            if (method == "POST" && path == "/qa/kill-team")
            {
                using var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8);
                var body = await reader.ReadToEndAsync();
                using var doc = JsonDocument.Parse(body);
                var teamStr = doc.RootElement.GetProperty("team").GetString()?.ToUpperInvariant();
                var targetTeam = teamStr == "CT" ? CsTeam.CounterTerrorist : CsTeam.Terrorist;

                var killed = await RunOnMainThreadAsync(() =>
                {
                    int count = 0;
                    foreach (var p in Utilities.GetPlayers())
                    {
                        if (p.IsValid && !p.IsHLTV && p.TeamNum == (int)targetTeam && p.PawnIsAlive && p.PlayerPawn.Value != null)
                        {
                            p.PlayerPawn.Value.CommitSuicide(false, true);
                            count++;
                        }
                    }
                    return count;
                });

                await WriteJsonAsync(ctx.Response, 200, JsonSerializer.Serialize(new { ok = true, killed }));
                return;
            }

            if (method == "POST" && path == "/qa/exec")
            {
                using var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8);
                var body = await reader.ReadToEndAsync();
                string? command = null;

                if (!string.IsNullOrWhiteSpace(body))
                {
                    if (body.TrimStart().StartsWith("{"))
                    {
                        using var doc = JsonDocument.Parse(body);
                        if (doc.RootElement.TryGetProperty("command", out var cmdProp))
                        {
                            command = cmdProp.GetString();
                        }
                    }
                    else
                    {
                        command = body.Trim();
                    }
                }

                if (string.IsNullOrWhiteSpace(command))
                {
                    await WriteJsonAsync(ctx.Response, 400, "{\"ok\":false,\"error\":\"missing command\"}");
                    return;
                }

                await RunOnMainThreadAsync(() =>
                {
                    Server.ExecuteCommand(command);
                    return "{\"ok\":true}";
                });

                await WriteJsonAsync(ctx.Response, 200, "{\"ok\":true}");
                return;
            }

            await WriteJsonAsync(ctx.Response, 404, "{\"ok\":false,\"error\":\"not found\"}");
        }
        catch (Exception ex)
        {
            var err = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
            await WriteJsonAsync(ctx.Response, 500, err);
        }
    }

    private static Task<T> RunOnMainThreadAsync<T>(Func<T> action)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Server.NextFrame(() =>
        {
            try
            {
                tcs.SetResult(action());
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
        });
        return tcs.Task;
    }

    private static string ReadGameStateJson()
    {
        int ctScore = 0;
        int tScore = 0;

        foreach (var team in Utilities.FindAllEntitiesByDesignerName<CCSTeam>("cs_team_manager"))
        {
            if (team.TeamNum == (int)CsTeam.CounterTerrorist)
            {
                ctScore = team.Score;
            }
            else if (team.TeamNum == (int)CsTeam.Terrorist)
            {
                tScore = team.Score;
            }
        }

        var gameRulesProxy = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").FirstOrDefault();
        var gameRules = gameRulesProxy?.GameRules;

        var players = Utilities.GetPlayers()
            .Where(p => p.IsValid && !p.IsHLTV && p.UserId.HasValue)
            .Select(p =>
            {
                var stats = p.ActionTrackingServices?.MatchStats;
                return new
                {
                    name = p.PlayerName,
                    steamId = p.SteamID.ToString(),
                    userId = p.UserId,
                    isBot = p.IsBot,
                    team = p.TeamNum == (int)CsTeam.CounterTerrorist ? "CT"
                         : p.TeamNum == (int)CsTeam.Terrorist ? "T"
                         : "SPEC",
                    alive = p.PawnIsAlive,
                    cash = p.InGameMoneyServices?.Account ?? 0,
                    kills = stats?.Kills ?? 0,
                    deaths = stats?.Deaths ?? 0,
                    assists = stats?.Assists ?? 0,
                    mvps = p.MVPs,
                    damage = stats?.Damage ?? 0
                };
            })
            .ToList();

        return JsonSerializer.Serialize(new
        {
            map = Server.MapName,
            gameRules = gameRules == null ? null : new
            {
                warmupPeriod = gameRules.WarmupPeriod,
                freezePeriod = gameRules.FreezePeriod,
                totalRoundsPlayed = gameRules.TotalRoundsPlayed,
                gamePhase = gameRules.GamePhase
            },
            teams = new
            {
                ct = new { score = ctScore },
                t = new { score = tScore }
            },
            players
        });
    }

    private static async Task WriteJsonAsync(HttpListenerResponse response, int statusCode, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
        response.Close();
    }
}
